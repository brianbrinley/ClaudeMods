#!/usr/bin/env perl
# Tests scripts/scan-sessions.pl against made-up transcripts. Run: prove boomi-dashboard/tests
use strict;
use warnings;
use File::Basename qw(dirname);
use File::Path qw(make_path);
use File::Temp qw(tempdir);
use JSON::PP ();
use Test::More;

my $script = dirname(__FILE__) . '/../scripts/scan-sessions.pl';
my $json = JSON::PP->new->canonical;
my $root = tempdir(CLEANUP => 1);

sub write_lines {
  my ($path, @records) = @_;
  make_path(dirname($path));
  open(my $fh, '>', $path) or die "$path: $!";
  print $fh (ref $_ ? $json->encode($_) : $_), "\n" for @records;
  close $fh;
}

sub reply {
  my (%a) = @_;
  return {
    type => 'assistant',
    sessionId => $a{session},
    cwd => '/work/orders',
    timestamp => $a{at},
    requestId => $a{request},
    message => {
      id => $a{id},
      model => 'claude-opus-5-5',
      usage => { input_tokens => 10, output_tokens => 20, cache_read_input_tokens => 300, cache_creation_input_tokens => 40 },
      content => $a{content} // [],
    },
  };
}

my $bash = sub { { type => 'tool_use', name => 'Bash', input => { command => $_[0] } } };
my $built = 'aaaaaaaa-1111-2222-3333-444444444444';
my $talked = 'bbbbbbbb-1111-2222-3333-444444444444';

write_lines(
  "$root/-work-orders/$built.jsonl",
  { type => 'user', sessionId => $built, isMeta => JSON::PP::true, message => { content => 'meta note' } },
  { type => 'user', sessionId => $built, message => { content => '<command-name>/clear</command-name>' } },
  { type => 'user', sessionId => $built, message => { content => [{ type => 'text', text => "Build the   orders\nsync process" }] } },
  { type => 'user', sessionId => $built, message => { content => 'a later message' } },
  # One reply written as two lines, one per content block: counted once.
  reply(session => $built, at => '2026-10-01T10:00:00Z', id => 'msg_1', request => 'req_1', content => [{ type => 'text', text => 'Pushing' }]),
  reply(session => $built, at => '2026-10-01T10:00:00Z', id => 'msg_1', request => 'req_1',
    content => [$bash->('bash scripts/boomi-component-push.sh active-development/processes/Orders.xml')]),
  '{"type":"assistant","message": broken',
  { type => 'cost-state', sessionId => $built, totalCostUSD => 0.5, hasUnknownModelCost => JSON::PP::false },
  { type => 'cost-state', sessionId => $built, totalCostUSD => 1.25, hasUnknownModelCost => JSON::PP::false },
);
# A subagent's transcript belongs to its session.
write_lines(
  "$root/-work-orders/$built/subagents/agent-1.jsonl",
  reply(session => $built, at => '2026-10-01T11:00:00Z', id => 'msg_2', request => 'req_2',
    content => [$bash->('bash scripts/boomi-deploy.sh active-development/processes/Orders.xml')]),
);
# A session that never names a Companion script isn't listed.
write_lines("$root/-work-other/$talked.jsonl", reply(session => $talked, at => '2026-10-02T10:00:00Z', id => 'msg_3', request => 'req_3'));

my $out = `perl $script --root $root`;
is($?, 0, 'exits 0');
my $scan = $json->decode($out);
is($scan->{scanned}, 3, 'reads every transcript, subagents included');
is($scan->{badLines}, 1, 'counts a line it cannot read and goes on');
is(scalar @{ $scan->{sessions} }, 1, 'lists only sessions that named a Companion script');

my ($s) = @{ $scan->{sessions} };
is($s->{id}, $built, 'by session id');
is($s->{project}, '/work/orders', 'with its working folder');
is($s->{costUsd}, 1.25, "takes Claude Code's latest running cost");
is_deeply($s->{models}{'claude-opus-5-5'}, { input => 20, output => 40, cacheRead => 600, cacheWrite => 80, calls => 2 }, 'counts each reply once');
is(scalar @{ $s->{commands} }, 2, "keeps the commands that name a script, the subagent's too");
is($s->{firstPrompt}, 'Build the orders sync process', 'its first request, on one line, past meta notes and command echoes');
is($s->{title}, undef, 'no title unless the session has one');
is($s->{startedAt}, '2026-10-01T10:00:00Z', 'from its first reply');
is($s->{endedAt}, '2026-10-01T11:00:00Z', 'to its last');

# A title the session was given wins.
write_lines("$root/-work-orders/$built.jsonl",
  { type => 'custom-title', sessionId => $built, customTitle => 'Orders sync build' },
  reply(session => $built, at => '2026-10-01T10:00:00Z', id => 'msg_9', request => 'req_9',
    content => [$bash->('bash scripts/boomi-component-push.sh active-development/processes/Orders.xml')]));
my ($titled) = @{ $json->decode(`perl $script --root $root`)->{sessions} };
is($titled->{title}, 'Orders sync build', "keeps the session's own title");

my $later = `perl $script --root $root --since 99999999999999`;
is(scalar @{ $json->decode($later)->{sessions} }, 0, '--since skips older transcripts');

# A session that used only another Companion plugin counts too.
my $datahub = 'dddddddd-0000-0000-0000-000000000001';
write_lines("$root/-work-mdm/$datahub.jsonl",
  reply(session => $datahub, at => '2026-10-02T10:00:00Z', id => 'msg_d', request => 'req_d',
    content => [$bash->('bash scripts/datahub-deployment.sh deploy u-1 r-1 --version 2')]));
my @all = @{ $json->decode(`perl $script --root $root`)->{sessions} };
ok((grep { $_->{id} eq $datahub } @all), "counts a session that ran only a Data Hub script");

my $none = $json->decode(`perl $script --root $root/missing`);
is($none->{error}, 'no transcripts folder', 'a missing folder is an empty answer, not a failure');

done_testing();
