# Piece set attribution

The piece sets in this directory are third-party artwork, taken unmodified from
the Lichess source tree (`lichess-org/lila`, `public/piece/<set>`). They are not
covered by this project's own licence — each keeps the one below.

| Directory  | Shown as  | Author                     | Licence |
| ---------- | --------- | -------------------------- | ------- |
| `merida`   | Classic   | Armando Hernandez Marroquin | [GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt) |
| `maestro`  | Maestro   | sadsnake1                  | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| `staunty`  | Staunty   | sadsnake1                  | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |

Two of these are **NonCommercial**: they may not be used in a commercial
deployment of this app. They are here because this is a personal, non-commercial
trainer. Anyone repurposing this project commercially must remove `maestro` and
`staunty` (and the corresponding entries in `PIECE_SETS` in
`components/BoardPanel.tsx`), or replace them with sets whose licence allows it.

The fourth style, "Standard", is not in this directory — it is the set that ships
with `react-chessboard` (the Cburnett design from Wikimedia Commons).

Full licence list for the upstream assets:
https://github.com/lichess-org/lila/blob/master/COPYING.md
