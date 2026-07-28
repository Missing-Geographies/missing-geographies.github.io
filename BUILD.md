# Build (optional)

This project runs as plain static files. GitHub Pages serves `index.html`, `styles.css`, and `script.js` directly, so you do NOT need any build step to work on or publish the site. Editing those files and committing is enough.

The optional build below just creates smaller, minified copies of the CSS and JS for faster page loads. It does not change how the site behaves.

## What it does

  Running the build produces two extra files:

- `styles.min.css` (minified from `styles.css`)
- `script.min.js` (minified from `script.js`)

The original `styles.css` and `script.js` stay as the readable, editable source. Always make your edits in the originals, then rebuild.

## Requirements

- Node.js and npm installed on your computer (https://nodejs.org)

## Commands

Run these once, from the project folder:

    npm install
    npm run build

`npm install` downloads the build tools listed in `package.json`. `npm run build` creates the two minified files.

## Going live with the minified files (optional)

The build alone changes nothing on the live site. To actually serve the smaller files, point `index.html` at them:

- change `styles.css` to `styles.min.css`
- change `script.js` to `script.min.js`

If you ever want to go back, just point those references at the original files again. Nothing is lost, because the source files are never modified by the build.
