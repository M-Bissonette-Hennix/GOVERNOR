# v0.1.0 Acceptance Tests

Run these before treating the deployment as commissioned.

## 1. Cold start

- [ ] App loads without console errors.
- [ ] Version is 0.1.0.
- [ ] A wake episode is created automatically if today is open and no episode is active.
- [ ] State screen shows exactly four behavioral entry options.

## 2. Anchor path

- [ ] Choose `I can't really get started`.
- [ ] Only one Anchor action is exposed as the principal instruction.
- [ ] DONE advances the sequence.
- [ ] ALREADY DID IT advances the sequence.
- [ ] CAN'T decomposes the current action before skipping it.
- [ ] Medication language never suggests changing dose/timing.
- [ ] After all Anchor actions, the app asks for a state reassessment rather than declaring the day finished.

## 3. Online bridge

- [ ] Choose `I'm up, but foggy / depleted`.
- [ ] A bounded bridge action appears.
- [ ] BEGIN CONTACT starts a timed block.
- [ ] Finish dialog forces an actual dose classification.
- [ ] CONTACT does not count as ADVANCE in Review.

## 4. Functional contract

- [ ] Choose `I'm functional`.
- [ ] Set discretionary time, cognitive endurance, and fixed-work state.
- [ ] Generate contract.
- [ ] No more than one Primary Advance appears.
- [ ] No more than two Continuity items appear.
- [ ] Physical is separated from intellectual continuity.
- [ ] Remaining healthy/watch domains appear as protected omissions where applicable.
- [ ] A PRESSURE/BREACH domain that cannot fit is shown as UNRESOLVED PRESSURE, never falsely described as safe to omit.
- [ ] With fixed paid work + one primary, at most one additional intellectual continuity context is scheduled.

## 5. Deep protection

- [ ] Begin a block.
- [ ] Tap PROTECT THIS.
- [ ] State becomes DEEP.
- [ ] Contract/rebalancing UI is suppressed while the block is active.
- [ ] Finish block and classify as SURGE.
- [ ] Portfolio recalculates after completion.

## 6. No catch-up debt

- [ ] Leave one or more domains untouched for several days in a test database, or adjust targets temporarily.
- [ ] Condition rises through WATCH/PRESSURE/BREACH.
- [ ] No screen reports accumulated missing hours.
- [ ] One meaningful dose reduces condition according to recent-contact logic.

## 7. Wake episodes

- [ ] SYSTEM → end current wake episode.
- [ ] Start another wake episode later in the same calendar day.
- [ ] If the second episode begins during the late window, normal contract is suppressed by Late/Second Wake mode.
- [ ] Override is available but explicit.

## 8. Persistence

- [ ] Edit a portfolio frontier.
- [ ] Reload app; edit remains.
- [ ] Start/finish a block; reload; history remains.
- [ ] Request persistent storage and verify SYSTEM status changes when the browser grants it.

## 9. Backup/restore

- [ ] Export JSON.
- [ ] Make a visible portfolio edit.
- [ ] Import the prior JSON.
- [ ] Confirm imported data replaces current local database after confirmation.

## 10. Offline

- [ ] Visit once while online.
- [ ] Close app.
- [ ] Disable network.
- [ ] Reopen Home Screen app.
- [ ] Core UI loads and local records remain usable.

## 11. Destructive wipe

- [ ] WIPE refuses any phrase except `WIPE GOVERNOR`.
- [ ] Correct phrase clears local records and reseeds initial domains.

## Commissioning criterion

Commission v0.1.0 only when all applicable tests pass on the actual iPhone Home Screen installation. Keep the first exported backup outside the browser/site-data store.
