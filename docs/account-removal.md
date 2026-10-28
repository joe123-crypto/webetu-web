# Account removal

Settings exposes Remove Account directly below the email toggle. A native modal
warns that the Webetu web account, stored details, associated application data,
and Firebase sign-in account are permanently deleted. It requires typing DELETE
and offers Cancel. Settings allows removal even before onboarding, without
requiring saved credentials. The server accepts only a same-origin JSON POST, explicit
confirmation, and a verified Firebase session. First-time removal requires an
unrevoked session authenticated within five minutes; older sessions must sign
out and sign in again.

## Storage audit and deletion scope

The configured Firebase project's default Firestore database and Firebase
Authentication are the application stores referenced by this repository.
No Firebase Storage, SQL database, or other user-file store is used here.

| Store | Deletion |
| --- | --- |
| `users/{uid}` | Root and all descendants, including public ID and onboarding state |
| `credentialRefs` | Deterministic Webetu reference plus every record with matching `userId`, all descendants, including encrypted secrets and revoked references |
| `webetuPreferences/{uid}` | Root, descendants, and matching `userId` records |
| `webetuOverrides` | Every record with matching `userId`, and descendants |
| `webetuMetadata/{uid}` | Cached location, descendants, and matching `userId` records |
| `webetuVerifyAttempts/{uid}` | Verification counters, descendants, and matching `userId` records |
| `webetuManualRuns/{uid}` | Cooldown, descendants, and matching `userId` records |
| `dashboardTaskStatus` | Both known task IDs plus every matching `userId` record; recursively includes `runs` even when parent documents are missing |
| Firebase Authentication | Disable during processing, then delete the identity |

Restaurant catalog/configuration and backend health alerts are shared records.
`webetuVerifyTargets/{hash(username)}` is a shared abuse-prevention budget across
all accounts, without a Firebase UID or ownership association. It is not an
owned user record and is retained. Successful credential verification already
clears that target budget. Do not delete arbitrary guessed targets on account
removal: that would permit attackers to reset another student's security budget.
The placeholder Google OAuth claim/revoke handlers persist no OAuth tokens.

## Failure and concurrency behavior

The first transaction marks `users/{uid}` as deletion requested. All application
user-data writes read that root in their own transaction and reject missing or
deleting accounts. Late worker callbacks cannot recreate reservation status or
history. Credential reads and the worker roster exclude deleting accounts.
Sign-in rejects the marker, and initial account creation checks that the Auth
identity still exists and is enabled inside its transaction.

Deletion removes each owned root’s child collections recursively before deleting
the root itself, keeping its ownership fields discoverable if a child delete
fails. It pages through ownership queries in groups of 100. It awaits every operation, deletes Auth after the
associated data, and removes the user root/fence last. Success clears the
server cookie and local Firebase state and shows an Account removed message.
No permanent deletion tombstone remains after success.

Any error is reported as incomplete, never as successful or rolled back. The
cookie is kept for retry. Only the deletion endpoint and Settings recovery view
may verify an unexpired session without the revocation check when the deletion
marker exists (or, for idempotent completion, Auth is already missing). These
paths grant deletion-only access; normal application authentication retains the
revocation check. Settings recovery shows only the retry control. A lost success
response can be retried safely. Once the cookie expires or is lost, an operator
must verify the requester through the support process and resume `removeAccount`
with privileged server tooling. There is no automatic background retry job.

## Retention boundaries to report honestly

This operation covers the current configured application project. The migration
script explicitly leaves source-project copies untouched; it does not configure
source credentials in the running application. Historical copies there require
separate operator action. No retention or deletion controls for Firestore
backups/PITR, infrastructure/access logs, analytics, Resend records, recipients'
mailboxes, Google, or Webetu are configured or verifiable from this repository.
No erasure of those copies is promised.

The separate reservation worker is called over HTTP. Its source, independent
storage, in-flight cancellation, and an account-deletion API are not present in
this repository. The web app stops exposing credentials/roster entries and
rejects late writes through its internal APIs, but cannot erase independent
worker storage or stop work that already holds credentials. Existing meals on
Webetu are not canceled and neither a Google account nor an external Webetu
account is deleted. These boundaries must accompany implementation reports;
they are not listed in the confirmation dialog per the requested UX.

## Validation

Use mocked Firebase tests; never delete a live user's account for verification.
The account removal tests cover scope/isolation, nested/orphan history, each
failure phase, retries with disabled/deleted Auth, lost responses, CSRF/session/
confirmation/recent-auth rejection, and blocked late writes/sign-in. UI tests
cover the warning, typed confirmation, Cancel, duplicate submission, pending,
error, success, placement, and the limited Settings recovery view.
