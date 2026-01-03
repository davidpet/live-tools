# Make Tiles

- Live Demo: https://davidpet.github.io/live-tools/make-lut/
- To install: `npm install`
- To run: `npm run start`
  - will run from `index.html` and `dist/` folder (built automatically)
- To build `npm run build` and look for `package.zip`
- To deploy to the github docs folder for hosting: `npm run deploy`
  - you have to have done `npm run build` first
  - it will clear away the whole target folder and recopy the artifacts
  - you then have to go make a commit in Git to update the copy that is hosted
- To clean the `dist/` folder: `npm run clean`
- If you deploy and commit, but the JS changes don't show up, you need to do a **Hard Refresh**
  - In Chrome, load chrome devtools
  - just having devtools open unlocks a right-click menu for the refresh button that isn't normally there
- If you clone this project and make a different version of it, you will need to change the stuff above `scripts` in `package.json`.
