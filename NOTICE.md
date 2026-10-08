# Notice

Copyright (C) 2026 the Subutai authors (see the git history).

Subutai is free software under the GNU Affero General Public License,
version 3 (see [LICENSE](./LICENSE)). The name "Subutai" and the logo are not
covered by that license.

## Third-party components that ship with the app

| Component | License | Note |
|---|---|---|
| [essentia.js](https://mtg.github.io/essentia.js/) 0.1.x | AGPL-3.0 | Music Technology Group, Universitat Pompeu Fabra. This is the reason the whole app is AGPL-3.0: the combined work that is served to users has to be offered under the same license. |
| TempoCNN model weights, `public/models/deeptemp-k16-3/` | CC BY-NC-SA 4.0 | From the Essentia project (MTG), converted to TensorFlow.js. **Non-commercial.** MTG also offers a proprietary license on request, which is required for any commercial use of these weights. Attribution: Music Technology Group, Universitat Pompeu Fabra. |
| [TensorFlow.js](https://www.tensorflow.org/js) 4.x | Apache-2.0 | |
| [Firebase JS SDK](https://github.com/firebase/firebase-js-sdk) 12.x | Apache-2.0 | |
| [React](https://react.dev/) and ReactDOM 19.x | MIT | |
| [lucide-react](https://lucide.dev/) | ISC | |

The license of the model weights is separate from the license of the source
code: the weights are data that the app loads at runtime, not part of the
program, and they keep their own terms.

## Services the app talks to

Firebase (anonymous sign-in and Firestore), Spotify (embedded player and oEmbed),
Deezer (tempo lookup), Twitch chat (read-only IRC), 7TV (emote images) and Google
Fonts. They are used under their own terms and are not redistributed here.
