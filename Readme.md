# Video Download Extension

A Chrome extension for downloading videos from YouTube and other websites.

## Server Setup

1. Install Python requirements:
bash
pip install -r requirements.txt

2. Run the server:
bash
python app.py

## Extension Setup

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `chrome-extension` folder

## Features

- YouTube video downloads
- Video size detection
- Progress tracking
- Download queue management

Update your repository structure:

video_download_extention/
├── README.md
├── requirements.txt
├── app.py
└── chrome-extension/
    ├── manifest.json
    ├── background.js
    ├── content.js
    ├── popup.html
    ├── popup.js
    └── icon.png
