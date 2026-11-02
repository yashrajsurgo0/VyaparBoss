# The Android and iPhone app

`mobile/` holds the KaantaMandi app for Google Play and the App Store. It is a [Capacitor](https://capacitorjs.com) shell: a native app that opens https://kaantamandi.com in a full-screen web view, with the KaantaMandi icon, a splash screen, a native status bar and an offline screen. The website **is** the app, so every push to `main` updates the app too. Only native changes (icon, name, permissions, plugins) need a new store release.

What's different inside the app (`NATIVE` in `src/js/app.js`):
- **Sign-in:** email and password only. Google, Apple and Facebook web sign-in don't work inside an app's web view. Add native sign-in plugins later if you want those buttons back (Apple then also requires Sign in with Apple).
- **Supplier plans:** shown, but not sold in the app. Apple and Google require their own billing for digital subscriptions bought in an app. Suppliers buy plans on the website, or the team switches them on. Don't add text in the app telling people to pay on the website: both stores forbid that.
- **Order payments:** Razorpay Checkout, same as the website (allowed: these are physical goods). UPI apps (GPay, PhonePe, Paytm…) open from the pay sheet; `AndroidManifest.xml` `<queries>` and iOS `LSApplicationQueriesSchemes` allow that.

## What you need

| | Android | iPhone |
|---|---|---|
| Account | Google Play Console, US$25 once (play.google.com/console) | Apple Developer Program, US$99 a year (developer.apple.com) |
| Software | Android Studio (includes the JDK and SDK) | Xcode, from the Mac App Store |
| Node | Node 22 for the Capacitor CLI (`npm run sync` fetches it on the fly) | same |

Register as an **organisation** (House of 24 Pvt. Ltd.) on both stores; it needs a D-U-N-S number (free, takes a few days).

## Build and test

```
cd mobile
npm install
npm run sync        # copies config and plugins into android/ and ios/
npm run android     # opens Android Studio → Run on an emulator or a phone
npm run ios         # opens Xcode → pick a simulator → Run
```

To test against your computer instead of the live site, temporarily set `"url": "http://<your-mac-ip>:5173"` and `"cleartext": true` under `server` in `capacitor.config.json`, run `npm run sync`, and change it back before a release.

Icons and splash screens are generated from `mobile/assets/` with `npm run icons`.

## Release

**Android (Play Store)**
1. Android Studio → Build → Generate Signed App Bundle → create an upload keystore. Keep the `.jks` file and its passwords safe and out of git; losing it blocks updates.
2. Play Console → Create app → upload the `.aab` to Internal testing first.
3. Fill in the store listing (screenshots are in `04_App_Screenshots/`), the Data safety form (matches `src/privacy.html`: account details, purchase history, no ads, data encrypted in transit, users can delete their account), content rating, and target audience (business users, 18+).
4. New personal developer accounts must run a closed test with testers for 14 days before production; organisation accounts can skip that.

**iPhone (App Store)**
1. Xcode → App target → Signing & Capabilities → pick your team. Bundle ID `com.kaantamandi.app`.
2. Product → Archive → Distribute App → App Store Connect. Test it with TestFlight.
3. App Store Connect: listing, screenshots (6.9" and 6.5" iPhone), privacy labels (as above), privacy policy URL `https://kaantamandi.com/privacy.html`, and a **demo account** for the reviewer (a buyer and a supplier login with sample data).
4. Review notes: say it's a B2B procurement marketplace for Indian businesses, payments are for physical goods via Razorpay, and accounts can be deleted in Account settings.

**Review risk:** Apple can reject apps that look like "just a website" (guideline 4.2). The app's native splash, status bar, offline screen and UPI hand-off help. If it's rejected, add push notifications for order updates (`@capacitor/push-notifications`, needs Firebase and an APNs key) and resubmit.

## Versions

Bump `versionCode`/`versionName` in `mobile/android/app/build.gradle` and the version/build in Xcode for each store upload.
