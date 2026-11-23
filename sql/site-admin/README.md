# Owner-only photo management

The only management account is **szqsunny@outlook.com**. This rule also applies
to future administration features, as recorded in the repository's AGENTS.md.
Public visitors may read published portraits; every management control starts
hidden. A verified Auth identity plus a successful Function owner check reveals
the controls. Sign-out/account changes immediately hide them and abort editing.

`schema.sql` resolves the existing, verified account once and pins its UUID in
`site_owner`. It fails if the account has not completed email login or if a
different UUID is already pinned. It never provisions an account, trusts
user_metadata, or automatically grants access on signup. `site_admin_authorize`
checks that UUID; the Function checks the current verified email/ban state with
GoTrue on every request. Its execution is service-role-only. New administration Functions must reuse
`authorizeSiteOwner` in `../dark-room/edge/index.ts` and the SQL owner guard.

Deploy in this order in the existing **Aliyun** project:

1. Run `schema.sql` in a trusted administrative environment, then the rolled-back
   `schema.test.sql`. It creates the dedicated public-read `people-portraits`
   bucket and forbids browser-role uploads, updates and deletes. The owner can
   write only through the Function. No changes to other buckets or user grants.
2. Deploy `../dark-room/edge/index.ts` as the existing `meet-api` Function, with
   gateway JWT checking disabled as in its current deployment. All private
   routes verify real bearer tokens against GoTrue internally. Preserve runtime
   secrets, existing community routes and `/dark-room`. No extra function slot
   or new production secret is required.
3. Build/deploy the frontend. The Function route is
   `/functions/v1/meet-api/people-photos`: `list` returns only published people
   and their public avatar URLs; `access` and multipart photo writes require
   both owner checks. Browser-supplied owner IDs and emails are never forwarded.

Photos are cropped to 640×640 JPEGs with a 900 KB output cap. A paste event
uses actual clipboard image bytes, so no clipboard-reading permission is needed.
Dragging and file selection share the same preview, zoom and position controls.
The Function checks image headers/dimensions and bounds streamed request bodies
even without Content-Length. The server builds immutable object URLs itself.

Saving uses the previous avatar URL as an optimistic lock. A conflicting edit
returns 409 and retains the existing photo. Records include the uploader UUID;
editorial drafts are preserved. Manual photos are locked against automatic
avatar writes, including jobs already queued before the edit. The public photo
lookup updates both directory and detail pages immediately after saving, while
the usual Aliyun snapshot sync/build also picks up the durable URL later.
Earlier objects are retained so older static snapshots and revision URLs work.

This source change does not itself install the SQL or deploy the Function.
Use production credentials only in the trusted deployment environment.
