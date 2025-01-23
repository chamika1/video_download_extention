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
            try:
                ydl_opts = {
                    'format': 'best',
                    'quiet': True,
                    'no_warnings': True,
                    'youtube_include_dash_manifest': False
                }
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                    formats = info.get('formats', [])
                    # Get the best format
                    best_format = next((f for f in formats if f.get('format_id') == info.get('format_id')), None)
                    
                    return jsonify({
                        'size': best_format.get('filesize') if best_format else info.get('filesize', 0),
                        'title': info.get('title', ''),
                        'duration': info.get('duration', 0)
                    })
            except Exception as e:
                logger.error(f"YouTube size extraction error: {str(e)}")
                return jsonify({'error': str(e)}), 500
        else:
            try:
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
                response = requests.head(url, headers=headers, allow_redirects=True, timeout=10)
                size = response.headers.get('content-length')
                if size:
                    return jsonify({'size': int(size)})
                else:
                    # Try GET request if HEAD doesn't provide size
                    response = requests.get(url, headers=headers, stream=True, timeout=10)
                    size = response.headers.get('content-length', 0)
                    return jsonify({'size': int(size) if size else 0})
            except requests.exceptions.RequestException as e:
                logger.error(f"Direct size fetch error: {str(e)}")
                return jsonify({'error': str(e)}), 500
            
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)  # Set debug=False for production 