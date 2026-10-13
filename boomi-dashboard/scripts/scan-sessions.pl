#!/usr/bin/env perl
# Sums up past Claude Code sessions that ran Boomi Companion scripts, for the
# dashboard's History. Reads each transcript one line at a time, so a transcript
# of any size works, and prints one small JSON summary on standard output.
#
#   perl scan-sessions.pl [--root DIR] [--since EPOCH_MS] [--max-commands N]
#
# --root   where the transcripts are; default $CLAUDE_CONFIG_DIR/projects,
#          else ~/.claude/projects
# --since  skip transcripts last written before this time
#
# Only core Perl modules, so it runs wherever Perl does (macOS and most Linux).
use strict;
use warnings;
use File::Find ();
use Getopt::Long ();
# JSON::PP is core Perl, but a minimal Debian or Ubuntu (WSL's, for one) can
# have only perl-base, which leaves it out. Say what to install instead of
# Perl's own "Can't locate" message.
BEGIN {
  unless (eval { require JSON::PP; 1 }) {
    print STDERR "Perl's JSON module is missing. On Debian or Ubuntu (WSL too): sudo apt install perl\n";
    exit 3;
  }
}

my $home = $ENV{HOME} // '';
my $root = $ENV{CLAUDE_CONFIG_DIR} ? "$ENV{CLAUDE_CONFIG_DIR}/projects" : "$home/.claude/projects";
my $since = 0;
my $max_commands = 40;
Getopt::Long::GetOptions('root=s' => \$root, 'since=i' => \$since, 'max-commands=i' => \$max_commands)
  or die "usage: scan-sessions.pl [--root DIR] [--since EPOCH_MS] [--max-commands N]\n";

my $json = JSON::PP->new->utf8->canonical;
my $out = JSON::PP->new->utf8->canonical;

unless (-d $root) {
  print $out->encode({ version => 1, root => $root, sessions => [], scanned => 0, error => 'no transcripts folder' }), "\n";
  exit 0;
}

# Every transcript, a subagent's included: <project>/<session>.jsonl and
# <project>/<session>/subagents/*.jsonl.
my @files;
File::Find::find(
  {
    no_chdir => 1,
    wanted => sub {
      return unless /\.jsonl\z/ && -f $_;
      my $mtime_ms = (stat _)[9] * 1000;
      push @files, $_ if $mtime_ms >= $since;
    },
  },
  $root,
);

# A message's first text: its content when that's a string, else its first text block.
sub first_text {
  my ($m) = @_;
  return undef unless ref $m eq 'HASH';
  my $c = $m->{content};
  return $c unless ref $c;
  return undef unless ref $c eq 'ARRAY';
  for my $block (@$c) {
    return $block->{text} if ref $block eq 'HASH' && ($block->{type} // '') eq 'text' && defined $block->{text};
  }
  return undef;
}

# One line of at most 80 characters.
sub short_text {
  my ($t) = @_;
  $t =~ s/\s+/ /g;
  $t =~ s/^ | $//g;
  return length($t) > 80 ? substr($t, 0, 79) . "\x{2026}" : $t;
}

my %sessions;
my ($scanned, $bad_lines) = (0, 0);

for my $file (sort @files) {
  open(my $fh, '<', $file) or next;
  $scanned++;
  my $is_subagent = $file =~ m{/subagents/};
  my ($file_session) = $file =~ m{/([0-9a-fA-F-]{8,})(?:\.jsonl\z|/subagents/)};
  my %seen;
  # The session's first request, read from its main transcript only, once.
  my $wants_prompt = !$is_subagent;
  while (my $line = <$fh>) {
    # Only these kinds carry what's kept; skipping the rest unread keeps it quick.
    my $is_title = $line =~ /"type":"(?:custom-title|ai-title|summary)"/;
    my $is_user = $wants_prompt && index($line, '"type":"user"') >= 0;
    next unless $is_title || $is_user || index($line, '"type":"assistant"') >= 0 || index($line, '"type":"cost-state"') >= 0;
    my $o = eval { $json->decode($line) };
    unless (ref $o eq 'HASH') { $bad_lines++; next }
    my $id = $o->{sessionId} // $file_session // $file;
    my $s = $sessions{$id} //= { id => $id, models => {}, commands => [], costUsd => undef };
    $s->{project} //= $o->{cwd} if !$is_subagent && defined $o->{cwd};
    if (my $t = $o->{timestamp}) {
      $s->{startedAt} = $t if !defined $s->{startedAt} || $t lt $s->{startedAt};
      $s->{endedAt} = $t if !defined $s->{endedAt} || $t gt $s->{endedAt};
    }

    # A title the session was given (/rename) or that Claude Code made for it.
    if ($is_title) {
      my $text = $o->{customTitle} // $o->{title} // $o->{aiTitle} // $o->{summary};
      $s->{title} = short_text($text) if defined $text && !ref $text && ($o->{type} eq 'custom-title' || !defined $s->{title});
      next;
    }
    if (($o->{type} // '') eq 'user') {
      next if $o->{isMeta} || $o->{isSidechain};
      my $text = first_text($o->{message});
      # Skip command echoes and system notes (<command-name>, <system-reminder>, ...).
      if (defined $text && $text !~ /^\s*(?:<|Caveat:)/ && $text =~ /\S/) {
        $s->{firstPrompt} = short_text($text);
        $wants_prompt = 0;
      }
      next;
    }

    if (($o->{type} // '') eq 'cost-state') {
      # Claude Code's own running total for the session, the figure /cost shows.
      my $usd = $o->{totalCostUSD};
      if (defined $usd && (!defined $s->{costUsd} || $usd > $s->{costUsd})) {
        $s->{costUsd} = $usd + 0;
        $s->{hasUnknownModelCost} = $o->{hasUnknownModelCost} ? JSON::PP::true : JSON::PP::false;
      }
      next;
    }

    my $m = $o->{message};
    next unless ref $m eq 'HASH';
    # One reply is written as several lines, one per content block, each with
    # the same usage: count it once.
    my $key = join "\t", $m->{id} // '', $o->{requestId} // '';
    if ($key ne "\t" && !$seen{$key}++) {
      my $u = $m->{usage};
      if (ref $u eq 'HASH') {
        my $model = $m->{model} // 'unknown';
        my $mm = $s->{models}{$model} //= { input => 0, output => 0, cacheRead => 0, cacheWrite => 0, calls => 0 };
        $mm->{input} += $u->{input_tokens} // 0;
        $mm->{output} += $u->{output_tokens} // 0;
        $mm->{cacheRead} += $u->{cache_read_input_tokens} // 0;
        $mm->{cacheWrite} += $u->{cache_creation_input_tokens} // 0;
        $mm->{calls}++;
      }
    }
    # The Bash commands that name a Companion script: the dashboard decides
    # which of them ran one. Nothing else of the conversation leaves this script.
    my $content = $m->{content};
    next unless ref $content eq 'ARRAY';
    for my $block (@$content) {
      next unless ref $block eq 'HASH' && ($block->{type} // '') eq 'tool_use' && ($block->{name} // '') eq 'Bash';
      my $command = ref $block->{input} eq 'HASH' ? $block->{input}{command} : undef;
      next unless defined $command && $command =~ /(?:boomi|datahub|bdi|agentstudio|connectordev)-[a-z-]+\.sh/;
      push @{ $s->{commands} }, substr($command, 0, 600) if @{ $s->{commands} } < $max_commands;
      $s->{companionCommands}++;
    }
  }
  close $fh;
}

# Only sessions that named a Companion script in a Bash command.
my @found = sort { ($b->{startedAt} // '') cmp ($a->{startedAt} // '') } grep { $_->{companionCommands} } values %sessions;
print $out->encode({ version => 1, root => $root, sessions => \@found, scanned => $scanned, badLines => $bad_lines }), "\n";
