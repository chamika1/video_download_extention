from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import yt_dlp
import requests
import os
import logging
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stdout
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Ensure download directory exists
if not os.path.exists('downloaded_videos'):
    os.makedirs('downloaded_videos')

@app.route('/')
def home():
    return jsonify({'status': 'ok', 'message': 'Server is running'})

@app.route('/status')
def status():
    return jsonify({'status': 'ok', 'version': '1.0'})

@app.route('/download', methods=['POST'])
def download_from_extension():
    try:
        data = request.get_json()
        url = data.get('url')
        is_youtube = data.get('isYouTube', False)
        
        if not url:
            return jsonify({'error': 'URL is required'}), 400

        if is_youtube:
            if not os.path.exists('downloaded_videos'):
                os.makedirs('downloaded_videos')

            ydl_opts = {
                'format': 'best',
                'outtmpl': os.path.join('downloaded_videos', '%(title)s.%(ext)s'),
                'quiet': True,
                'merge_output_format': 'mp4'
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                video_path = ydl.prepare_filename(info)
                return send_file(
                    video_path,
                    as_attachment=True,
                    download_name=os.path.basename(video_path),
                    mimetype='video/mp4'
                )

        return jsonify({'error': 'Unsupported URL type'}), 400
        
    except Exception as e:
        logger.error(f"Error during download: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/get-file-size', methods=['POST'])
def get_file_size():
    try:
        data = request.get_json()
        url = data.get('url')
        is_youtube = data.get('isYouTube', False)
        
        if not url:
            return jsonify({'error': 'URL is required'}), 400

        if is_youtube:
            ydl_opts = {
                'format': 'best',
                'quiet': True
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                return jsonify({
                    'size': info.get('filesize') or info.get('filesize_approx', 0),
                    'title': info.get('title', '')
                })
        else:
            response = requests.head(url, allow_redirects=True)
            size = response.headers.get('content-length', 0)
            return jsonify({'size': size})
            
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port) 