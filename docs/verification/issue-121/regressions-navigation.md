# Mobile navigation regression

Base: `d2886cb8aba87fab6272d3efb2cae54d708a9292`.

The deployed dialog had a 220 ms entrance keyframe but called native `dialog.close()` immediately on Back/X/Escape/link selection. A closed native dialog no longer renders, so CSS could not animate its exit.

The candidate holds the native modal and body scroll lock through a 220 ms leftward exit, closes on its own exit animation end, and has a 280 ms fallback if that event is lost. Reduced motion closes immediately. The exit starts from the current computed transform, including an interrupted entrance. History consumes the menu entry before navigation; selecting the current path avoids a duplicate navigation. Forward during an exit cancels the pending exit. Logout consumes the menu history entry and waits for the exit before resubmitting the original form.

`tests/e2e/mobile-storefront-121.spec.ts` observes actual Web Animations and animationstart lifecycle for X/Escape/Back/link, native open and scroll lock during exit, focus restoration, and repeated reduced-motion open/close. The focused animation test passed on mobile WebKit before final integration. Final candidate results are recorded separately; physical iPhone Safari is NOT RUN.

Unit coverage checks the fallback and keeps the dialog open while exit is pending. Existing responsive header, navigation, authentication font floor and desktop scenarios remain part of final browser verification.
