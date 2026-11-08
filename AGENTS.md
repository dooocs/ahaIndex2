# Website administration

- Administration controls are exclusive to the verified account
  `szqsunny@outlook.com`. Apply this rule to future management features.
- Hide management controls by default. Reveal them only after the real Auth
  identity and the Function's pinned `site_owner` check both succeed.
- All administration writes must pass through a Function using
  `authorizeSiteOwner`; SQL dispatchers also check `site_admin_authorize`.
  Reuse these guards rather than creating separate email allowlists or
  client-only permissions. Do not trust request-supplied email/account IDs,
  editable user metadata, localStorage, or hidden UI as authorization.
- Keep privileged keys server-side. Never retrieve production credentials just
  to design or test a management interface. Use isolated fixtures for tests.
- People source data and manual photos belong to the Aliyun project. Keep the
  official news Supabase database as the existing read-only build snapshot.

See `sql/site-admin/README.md` for the owner binding and deployment order.
