# Kindle Chess

A simple chess app made for Kindle's e-ink screen. No install, no account, just open it in the browser.

![Play screen](docs/play-light.png)

## Features

- Play vs computer (8 difficulty levels) or pass-and-play with a friend
- Chess puzzles to practice tactics
- Light and dark mode
- Choice of piece styles
- No animations, works well on slow e-ink screens
- Works offline after the first load

## Screenshots

| Play | Dark mode |
| --- | --- |
| ![Play](docs/play-light.png) | ![Dark mode](docs/play-dark.png) |

| Puzzles | Settings |
| --- | --- |
| ![Puzzles](docs/puzzle.png) | ![Settings](docs/settings.png) |

## How to use it

- Tap a piece, then tap a square to move
- Use the **Settings** button to change mode, difficulty, pieces, and theme
- Use the **Puzzles** button to practice tactics
- Use **Refresh** to clear screen ghosting on e-ink

## Running it

No build step needed, it's just static files.

```
python -m http.server 8000
```

Then open `http://localhost:8000` (or your computer's IP, from the Kindle).

## Credits

- Chess rules by [chess.js](https://github.com/jhlywa/chess.js)
- Piece art and puzzles from [Lichess](https://lichess.org) (open licensed)
