import os
import time
import shutil
import sqlite3
import zipfile
import logging
import mimetypes
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, session, send_file, redirect, url_for, Response
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ANDROID_MODE = os.path.exists('/sdcard')

log_file = os.path.join(BASE_DIR, "server.log")
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] - %(message)s',
    handlers=[logging.FileHandler(log_file, encoding='utf-8')]
)

werkzeug_logger = logging.getLogger('werkzeug')
werkzeug_logger.setLevel(logging.ERROR)
werkzeug_logger.addHandler(logging.FileHandler(log_file, encoding='utf-8'))

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'demonz_cloud_master_key_v9')
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024 * 1024
app.config['SESSION_PERMANENT'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)

if ANDROID_MODE:
    STORAGE_ROOT = '/sdcard'
else:
    STORAGE_ROOT = os.path.join(BASE_DIR, 'storage_data')

DB_PATH = os.path.join(BASE_DIR, 'demonz.db')
AVATAR_DIR = os.path.join(BASE_DIR, 'avatars')
TEMP_CHAT_DIR = os.path.join(BASE_DIR, 'temp_chat')

try:
    if not ANDROID_MODE: os.makedirs(STORAGE_ROOT, exist_ok=True)
    os.makedirs(AVATAR_DIR, exist_ok=True)
    if os.path.exists(TEMP_CHAT_DIR):
        try:
            shutil.rmtree(TEMP_CHAT_DIR)
        except: pass
    os.makedirs(TEMP_CHAT_DIR, exist_ok=True)
except Exception as e:
    logging.error(f"Init Error: {e}")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY, password TEXT NOT NULL, is_owner INTEGER DEFAULT 0,
        last_seen REAL DEFAULT 0, nickname TEXT, bio TEXT
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, target TEXT, content TEXT, 
        timestamp REAL, type TEXT DEFAULT 'text'
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS read_receipts (
        user TEXT, chat_target TEXT, last_read REAL, PRIMARY KEY (user, chat_target)
    )''')
    
    try:
        columns = [i[1] for i in c.execute("PRAGMA table_info(messages)").fetchall()]
        if 'type' not in columns:
            c.execute("ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'text'")
    except: pass
    
    conn.commit()
    conn.close()

init_db()

def get_user_path(username, vault=False, subpath=""):
    safe_subpath = subpath.strip('/').replace('..', '')
    
    if ANDROID_MODE:
        if vault:
            vault_root = os.path.join(STORAGE_ROOT, 'DemonzVaults', username)
            
            if not os.path.exists(vault_root):
                try:
                    os.makedirs(vault_root, exist_ok=True)
                except Exception as e:
                    logging.error(f"Failed to create Android vault directory: {e}")
            
            if not subpath:
                return vault_root
            
            full_path = os.path.join(vault_root, safe_subpath)
            
            try:
                if os.path.commonpath([vault_root, full_path]) == vault_root:
                    return full_path
            except Exception:
                return None
            return None
        else:
            if not subpath:
                return STORAGE_ROOT
            
            full_path = os.path.join(STORAGE_ROOT, safe_subpath)
            
            try:
                if os.path.commonpath([STORAGE_ROOT, full_path]) == STORAGE_ROOT:
                    return full_path
            except Exception:
                return None
            return None
    else:
        mode = 'vault' if vault else 'public'
        user_root = os.path.join(STORAGE_ROOT, 'users', username, mode)
        
        if not os.path.exists(user_root):
            try:
                os.makedirs(user_root, exist_ok=True)
            except Exception as e:
                logging.error(f"Failed to create desktop directory: {e}")
        
        if not subpath:
            return user_root
        
        full_path = os.path.join(user_root, safe_subpath)
        
        try:
            if os.path.commonpath([user_root, full_path]) == user_root:
                return full_path
        except Exception:
            return None
        return None

@app.before_request
def activity_tracker():
    if 'user' in session:
        try:
            last_check = session.get('last_active_check', 0)
            current_time = time.time()
            if current_time - last_check > 60:
                conn = get_db()
                conn.execute("UPDATE users SET last_seen = ? WHERE username = ?", (current_time, session['user']))
                conn.commit()
                conn.close()
                session['last_active_check'] = current_time
        except: pass

@app.route('/')
def index():
    is_owner = False
    if 'user' in session:
        conn = get_db()
        user = conn.execute("SELECT is_owner FROM users WHERE username = ?", (session['user'],)).fetchone()
        conn.close()
        if user and user['is_owner']: is_owner = True
    return render_template('index.html', session=session, is_owner=is_owner, username=session.get('user'))

@app.route('/login', methods=['POST'])
def login():
    username = request.form.get('username')
    password = request.form.get('password')
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    
    if user and check_password_hash(user['password'], password):
        session['user'] = username
        return jsonify({'status': 'success'})
    return jsonify({'status': 'error', 'msg': 'Invalid credentials'}), 401

@app.route('/register', methods=['POST'])
def register():
    username = request.form.get('username')
    password = request.form.get('password')
    
    if not username or not password: return jsonify({'msg': 'Missing fields'}), 400
    
    conn = get_db()
    try:
        if conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
            return jsonify({'msg': 'Username taken'}), 409
            
        user_count = conn.execute("SELECT count(*) FROM users").fetchone()[0]
        is_owner = 1 if user_count == 0 else 0
        
        conn.execute("INSERT INTO users (username, password, is_owner) VALUES (?, ?, ?)", 
                     (username, generate_password_hash(password), is_owner))
        conn.commit()
        
        if not ANDROID_MODE: 
            get_user_path(username, False)
            get_user_path(username, True)

        session['user'] = username
        return jsonify({'status': 'success'})
    finally:
        conn.close()

@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect(url_for('index'))

@app.route('/api/files')
def list_files():
    if 'user' not in session: return jsonify({}), 403
    path = request.args.get('path', '')
    vault = request.args.get('vault') == '1'
    
    abs_path = get_user_path(session['user'], vault, path)
    files = []
    
    if abs_path:
        if not os.path.exists(abs_path):
            try:
                os.makedirs(abs_path, exist_ok=True)
            except: pass
            
        if os.path.exists(abs_path):
            try:
                with os.scandir(abs_path) as entries:
                    for entry in entries:
                        files.append({
                            'name': entry.name,
                            'is_dir': entry.is_dir(),
                            'size': entry.stat().st_size if entry.is_file() else 0,
                            'modified': entry.stat().st_mtime
                        })
            except Exception as e:
                logging.error(f"Scan Error: {e}")
                return jsonify({'error': str(e)}), 500
            
    return jsonify({'files': files})

@app.route('/api/upload', methods=['POST'])
def upload_files():
    if 'user' not in session: return jsonify({}), 403
    path = request.form.get('path', '')
    vault = request.form.get('vault') == '1'
    upload_dir = get_user_path(session['user'], vault, path)
    
    if not upload_dir: return jsonify({'msg': 'Invalid path'}), 400
    if not os.path.exists(upload_dir):
        os.makedirs(upload_dir, exist_ok=True)
    
    files = request.files.getlist('files')
    count = 0
    
    for file in files:
        if file.filename:
            filename = secure_filename(file.filename)
            if not filename:
                filename = f"file_{int(time.time())}_{count}"
            save_path = os.path.join(upload_dir, filename)
            try:
                file.save(save_path) 
                count += 1
            except: pass
            
    return jsonify({'status': 'success', 'msg': f'{count} files uploaded'})

@app.route('/api/create', methods=['POST'])
def create_item():
    if 'user' not in session: return jsonify({}), 403
    data = request.json
    name = secure_filename(data.get('name', ''))
    base_path = get_user_path(session['user'], data.get('vault')==1, data.get('path', ''))
    target_path = os.path.join(base_path, name)
    
    try:
        if data.get('type') == 'folder':
            os.makedirs(target_path, exist_ok=True)
        else:
            with open(target_path, 'w') as f: f.write('')
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'msg': str(e)}), 500

@app.route('/api/delete', methods=['POST'])
def delete_items():
    if 'user' not in session: return jsonify({}), 403
    data = request.json
    vault = data.get('vault') == 1
    
    for rel_path in data.get('files', []):
        abs_path = get_user_path(session['user'], vault, rel_path)
        if abs_path in [BASE_DIR, DB_PATH, log_file, __file__]: continue
            
        if abs_path and os.path.exists(abs_path):
            try:
                if os.path.isdir(abs_path): shutil.rmtree(abs_path)
                else: os.remove(abs_path)
            except: pass
                
    return jsonify({'status': 'success'})

@app.route('/api/rename', methods=['POST'])
def rename_item():
    if 'user' not in session: return jsonify({}), 403
    data = request.json
    old_abs = get_user_path(session['user'], data.get('vault')==1, data.get('old_path'))
    
    if not old_abs or not os.path.exists(old_abs): return jsonify({'msg': 'Not found'}), 404
    
    new_name = secure_filename(data.get('new_name'))
    new_abs = os.path.join(os.path.dirname(old_abs), new_name)
    
    try:
        os.rename(old_abs, new_abs)
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'msg': str(e)}), 500

@app.route('/api/zip', methods=['POST'])
def zip_items():
    if 'user' not in session: return jsonify({}), 403
    data = request.json
    vault = data.get('vault') == 1
    base_path = get_user_path(session['user'], vault, data.get('path', ''))
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = f"archive_{timestamp}.zip"
    zip_path = os.path.join(base_path, zip_name)
    
    try:
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for item in data.get('files', []):
                abs_item_path = os.path.join(base_path, item)
                if os.path.exists(abs_item_path):
                    if os.path.isdir(abs_item_path):
                        for root, dirs, files in os.walk(abs_item_path):
                            for file in files:
                                file_path = os.path.join(root, file)
                                arcname = os.path.relpath(file_path, os.path.dirname(abs_item_path))
                                zipf.write(file_path, arcname)
                    else:
                        zipf.write(abs_item_path, item)
        return jsonify({'status': 'success', 'msg': 'Archive created'})
    except Exception as e:
        return jsonify({'status': 'error', 'msg': str(e)}), 500

@app.route('/api/unzip', methods=['POST'])
def unzip_item():
    if 'user' not in session: return jsonify({}), 403
    data = request.json
    vault = data.get('vault') == 1
    file_path = data.get('file')
    current_path = data.get('path', '')
    
    abs_zip_path = get_user_path(session['user'], vault, os.path.join(current_path, file_path))
    extract_to = os.path.dirname(abs_zip_path)
    
    try:
        if zipfile.is_zipfile(abs_zip_path):
            with zipfile.ZipFile(abs_zip_path, 'r') as zip_ref:
                zip_ref.extractall(extract_to)
            return jsonify({'status': 'success', 'msg': 'Extracted successfully'})
        return jsonify({'status': 'error', 'msg': 'Invalid zip file'}), 400
    except Exception as e:
        return jsonify({'status': 'error', 'msg': str(e)}), 500

@app.route('/api/get_content')
def get_file_content():
    if 'user' not in session: return jsonify({}), 403
    path = request.args.get('path')
    vault = request.args.get('vault') == '1'
    abs_path = get_user_path(session['user'], vault, path)
    
    if abs_path and os.path.exists(abs_path):
        try:
            with open(abs_path, 'r', encoding='utf-8') as f:
                return jsonify({'content': f.read()})
        except UnicodeDecodeError:
            return jsonify({'error': 'Binary or unsupported file type'}), 400
    return jsonify({'error': 'File not found'}), 404

@app.route('/api/save_file', methods=['POST'])
def save_file_content():
    if 'user' not in session: return jsonify({}), 403
    data = request.json
    abs_path = get_user_path(session['user'], data.get('vault')==1, data.get('path'))
    
    try:
        with open(abs_path, 'w', encoding='utf-8') as f:
            f.write(data.get('content', ''))
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'msg': str(e)}), 500

@app.route('/api/download')
def download_file():
    if 'user' not in session: return "Unauthorized", 403
    abs_path = get_user_path(session['user'], request.args.get('vault')=='1', request.args.get('path'))
    if abs_path and os.path.isfile(abs_path):
        return send_file(abs_path)
    return "File not found", 404

@app.route('/api/messages')
def get_messages():
    if 'user' not in session: return jsonify({}), 403
    target = request.args.get('target', 'global')
    user = session['user']
    conn = get_db()
    
    conn.execute("INSERT OR REPLACE INTO read_receipts (user, chat_target, last_read) VALUES (?, ?, ?)", 
                 (user, target, time.time()))
    conn.commit()
    
    if target == 'global':
        sql = "SELECT * FROM messages WHERE target='global' ORDER BY timestamp ASC LIMIT 200"
        msgs = conn.execute(sql).fetchall()
    else:
        sql = "SELECT * FROM messages WHERE (sender=? AND target=?) OR (sender=? AND target=?) ORDER BY timestamp ASC LIMIT 200"
        msgs = conn.execute(sql, (user, target, target, user)).fetchall()
        
    conn.close()
    response = jsonify({'messages': [dict(m) for m in msgs] if msgs else []})
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/api/send_message', methods=['POST'])
def send_message():
    if 'user' not in session: return jsonify({}), 403
    data = request.json
    content = data.get('content', '').strip()
    msg_type = data.get('type', 'text')
    
    if not content: return jsonify({}), 400
    
    conn = get_db()
    conn.execute("INSERT INTO messages (sender, target, content, timestamp, type) VALUES (?, ?, ?, ?, ?)", 
                 (session['user'], data.get('target', 'global'), content, time.time(), msg_type))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route('/api/chat/upload', methods=['POST'])
def chat_upload():
    if 'user' not in session: return jsonify({}), 403
    f = request.files.get('file')
    if not f: return jsonify({'status': 'error'}), 400
    
    filename = secure_filename(f.filename)
    unique_name = f"{int(time.time())}_{filename}"
    save_path = os.path.join(TEMP_CHAT_DIR, unique_name)
    f.save(save_path)
    return jsonify({'status': 'success', 'filename': unique_name})

@app.route('/api/chat/file/<filename>')
def get_chat_file(filename):
    if 'user' not in session: return "Unauthorized", 403
    return send_file(os.path.join(TEMP_CHAT_DIR, secure_filename(filename)))

@app.route('/api/chat_users')
def chat_users():
    if 'user' not in session: return jsonify({}), 403
    conn = get_db()
    users_db = conn.execute("SELECT username, last_seen FROM users").fetchall()
    conn.close()
    
    users = []
    now = time.time()
    for u in users_db:
        if u['username'] == session['user']: continue
        is_online = (now - (u['last_seen'] or 0)) < 300
        users.append({'name': u['username'], 'online': is_online})
    return jsonify({'users': users})

@app.route('/api/stats')
def get_stats():
    if 'user' not in session: return jsonify({}), 403
    cpu, ram = 0, 0
    try:
        load = os.getloadavg()
        cpu_count = os.cpu_count() or 1
        cpu = min(100, round((load[0] / cpu_count) * 100, 1))
        
        if os.path.exists('/proc/meminfo'):
            with open('/proc/meminfo', 'r') as f:
                m = {l.split(':')[0]: int(l.split(':')[1].split()[0]) for l in f if ':' in l}
            total = m.get('MemTotal', 1)
            avail = m.get('MemAvailable', m.get('MemFree', 0))
            ram = round(((total - avail) / total) * 100, 1)
    except: pass
    return jsonify({'cpu': cpu, 'ram': ram})

@app.route('/api/storage')
def api_storage():
    if 'user' not in session: return jsonify({}), 403
    try:
        total, used, free = shutil.disk_usage(STORAGE_ROOT)
        percent = round((used/total)*100, 1)
        def fmt(n):
            for u in ['B','KB','MB','GB','TB']:
                if n < 1024: return f"{n:.1f} {u}"
                n /= 1024
        return jsonify({'used': fmt(used), 'total': fmt(total), 'percent': percent})
    except: return jsonify({'used': '0 B', 'total': '0 B', 'percent': 0})

@app.route('/api/avatar/<username>')
def get_avatar(username):
    path = os.path.join(AVATAR_DIR, secure_filename(username))
    if os.path.exists(path): return send_file(path)
    import hashlib
    h = hashlib.md5(username.encode()).hexdigest()
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#111"/><circle cx="50" cy="50" r="40" fill="#{h[:6]}"/><text x="50" y="55" font-family="Arial" font-size="40" fill="white" text-anchor="middle" font-weight="bold">{username[0].upper()}</text></svg>'
    return Response(svg, mimetype='image/svg+xml')

@app.route('/api/upload_avatar', methods=['POST'])
def upload_avatar():
    if 'user' not in session: return jsonify({}), 403
    f = request.files.get('avatar')
    if f:
        f.save(os.path.join(AVATAR_DIR, secure_filename(session['user'])))
        return jsonify({'status': 'success'})
    return jsonify({'msg': 'No file'}), 400

@app.route('/api/profile/update', methods=['POST'])
def update_profile():
    if 'user' not in session: return jsonify({}), 403
    data = request.json
    conn = get_db()
    conn.execute("UPDATE users SET nickname=?, bio=? WHERE username=?", 
                 (data.get('nickname', ''), data.get('bio', ''), session['user']))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route('/api/user/<username>')
def get_user_info(username):
    if 'user' not in session: return jsonify({}), 403
    conn = get_db()
    user = conn.execute("SELECT username, nickname, bio, is_owner, last_seen FROM users WHERE username=?", (username,)).fetchone()
    conn.close()
    if user: return jsonify(dict(user))
    return jsonify({'error': 'User not found'}), 404

@app.route('/api/users')
def api_users():
    if 'user' not in session: return jsonify([]), 403
    conn = get_db()
    me = conn.execute("SELECT is_owner FROM users WHERE username=?", (session['user'],)).fetchone()
    if not me or not me['is_owner']:
        conn.close()
        return jsonify([]), 403
    users = conn.execute("SELECT username, is_owner, last_seen, nickname FROM users").fetchall()
    conn.close()
    return jsonify([dict(u) for u in users])

@app.route('/api/admin/delete_user', methods=['POST'])
def delete_user():
    if 'user' not in session: return jsonify({}), 403
    target = request.json.get('username')
    if not target or target == session['user']: return jsonify({'msg': 'Invalid target'}), 400
    
    conn = get_db()
    try:
        me = conn.execute("SELECT is_owner FROM users WHERE username=?", (session['user'],)).fetchone()
        if not me or not me['is_owner']: return jsonify({'msg': 'Unauthorized'}), 403
        
        conn.execute("DELETE FROM users WHERE username=?", (target,))
        conn.execute("DELETE FROM messages WHERE sender=? OR target=?", (target, target))
        conn.execute("DELETE FROM read_receipts WHERE user=?", (target,))
        conn.commit()
        
        return jsonify({'status': 'success'})
    finally:
        conn.close()

@app.route('/api/reset_users', methods=['POST'])
def reset_users():
    if 'user' not in session: return jsonify({}), 403
    conn = get_db()
    try:
        user = conn.execute("SELECT is_owner FROM users WHERE username=?", (session['user'],)).fetchone()
        if not user or not user['is_owner']: return jsonify({'msg': 'Unauthorized'}), 403
        
        conn.execute("DELETE FROM users WHERE username != ?", (session['user'],))
        conn.execute("DELETE FROM messages")
        conn.execute("DELETE FROM read_receipts")
        conn.commit()
        return jsonify({'status': 'success'})
    finally: conn.close()

if __name__ == '__main__':
    
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
