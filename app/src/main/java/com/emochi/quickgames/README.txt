Adivery rewarded-ad native/web fix

Native:
- Registers Adivery listener before preload.
- Queues rewarded requests until onRewardedAdLoaded.
- Emits rewarded_completed/reward_granted before rewarded_closed.
- showRewarded() returns true when request is queued.
- Fixes generic isAdLoaded default to rewarded placement.

Web:
- Reward is credited automatically on confirmed completion.
- Removed extra reward claim-button dependency from rewarded modal.
- Duplicate reward callbacks are guarded.

MainActivity:
- Preload happens only after WebView bridge/listener is installed.
