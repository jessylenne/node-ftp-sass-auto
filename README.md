# Node auto compile/sync of sass file via FTP

Usefull when you work with sass directly via a FTP, you don't have to download/compile/upload your file, this app does it for you
Open a browser in hot-reload (auto reload on changes), you can sync multiple devices at one via BrowserSync

## Installation
	npm install

## Launch
    node watch.js

## How-to

Fill the form opened at launch and click "Watch", this will download your files, open the project's directory and the hot-reload URL.
Edit your files as usual, the app will compile and upload them, and refresh all the browsers connected.

## Using
- BrowserSync
- node-ftp
- node-sass
