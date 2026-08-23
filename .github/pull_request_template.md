## Summary

Describe the user-visible change and why it belongs in Meetron Community.

## Safety and privacy

- [ ] Unknown audio, microphone, camera, or admission states still fail closed.
- [ ] No meeting URL secrets, Project IDs, cookies, credentials, or local logs are committed.
- [ ] Provider-specific selectors remain inside their provider or preparation module.
- [ ] User documentation is updated when setup, storage, permissions, or behavior changes.

## Verification

- [ ] `npm test`
- [ ] `npm audit --audit-level=high`
- [ ] Native audio tests were run when native code or packaging changed.
- [ ] I tested with non-confidential data only.
- [ ] Every commit includes a `Signed-off-by` line (`git commit -s`).
