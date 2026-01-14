#!/bin/bash

# ==============================================================================
# Dz-Core: Production-Grade Launch Manager
# Repository: https://github.com/sdemonzdevelopment-spec/Dz-Core
# Architecture: Modular Monolith with 6 Functional Modules
# Version: 2.0.0
# ==============================================================================

# --- CONFIGURATION CONSTANTS ---
readonly PORT_DEFAULT=5000
readonly LOG_FILE="server.log"
readonly DB_FILE="demonz.db"
readonly PID_FILE=".pid"
readonly VENV_DIR=".venv"
readonly ENV_FILE=".env"
readonly REQUIREMENTS_FILE="requirements.txt"
readonly BACKUP_DIR="backups"
readonly LOG_ROTATE_SIZE=5242880  # 5MB in bytes

# --- ANSI COLOR CODES ---
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly PURPLE='\033[0;35m'
readonly CYAN='\033[0;36m'
readonly WHITE='\033[1;37m'
readonly BOLD='\033[1m'
readonly NC='\033[0m' # No Color

# --- GLOBAL STATE ---
ENV_TYPE=""
SERVER_PID=""
IS_RUNNING=false
CURRENT_PORT=${PORT_DEFAULT}

# ==============================================================================
# MODULE 1: ENVIRONMENT & VENV MANAGEMENT
# ==============================================================================

detect_environment() {
    if [ -d "/sdcard" ] && [ -d "/data/data/com.termux" ]; then
        ENV_TYPE="Termux (Android)"
        export IS_TERMUX=true
    else
        ENV_TYPE="Linux (Standard)"
        export IS_TERMUX=false
    fi
    echo -e "${CYAN}[ENV] Detected: ${YELLOW}${ENV_TYPE}${NC}"
}

setup_virtualenv() {
    echo -e "${CYAN}[VENV] Checking virtual environment...${NC}"
    
    if [ ! -d "${VENV_DIR}" ]; then
        echo -e "${YELLOW}[VENV] Creating new virtual environment...${NC}"
        if ! python3 -m venv "${VENV_DIR}"; then
            echo -e "${RED}[VENV] Failed to create virtual environment${NC}"
            if [ "${ENV_TYPE}" = "Termux (Android)" ]; then
                echo -e "${YELLOW}[VENV] Installing python3-venv on Termux...${NC}"
                pkg install python -y && python3 -m venv "${VENV_DIR}"
            else
                echo -e "${YELLOW}[VENV] Installing python3-venv...${NC}"
                sudo apt-get update && sudo apt-get install python3-venv -y
                python3 -m venv "${VENV_DIR}"
            fi
        fi
        export VENV_NEW=true
    else
        export VENV_NEW=false
    fi
    
    # Activate virtual environment
    if [ -f "${VENV_DIR}/bin/activate" ]; then
        source "${VENV_DIR}/bin/activate"
        echo -e "${GREEN}[VENV] Virtual environment activated${NC}"
    elif [ -f "${VENV_DIR}/Scripts/activate" ]; then
        source "${VENV_DIR}/Scripts/activate"
        echo -e "${GREEN}[VENV] Virtual environment activated (Windows)${NC}"
    else
        echo -e "${RED}[VENV] Cannot activate virtual environment${NC}"
        return 1
    fi
}

install_dependencies() {
    local force_install=false
    
    # Check if requirements.txt exists
    if [ ! -f "${REQUIREMENTS_FILE}" ]; then
        echo -e "${YELLOW}[DEPS] requirements.txt not found, creating default...${NC}"
        cat > "${REQUIREMENTS_FILE}" << EOF
flask>=2.3.0
werkzeug>=2.3.0
gunicorn>=20.1.0
python-dotenv>=1.0.0
EOF
        force_install=true
    fi
    
    # Check if venv is new or requirements changed
    if [ "${VENV_NEW}" = true ] || [ "${force_install}" = true ] || \
       [ "${REQUIREMENTS_FILE}" -nt "${VENV_DIR}/.timestamp" ]; then
        echo -e "${CYAN}[DEPS] Installing/updating dependencies...${NC}"
        
        # Upgrade pip first
        pip install --upgrade pip
        
        # Install requirements
        if pip install -r "${REQUIREMENTS_FILE}"; then
            touch "${VENV_DIR}/.timestamp"
            echo -e "${GREEN}[DEPS] Dependencies installed successfully${NC}"
        else
            echo -e "${RED}[DEPS] Failed to install dependencies${NC}"
            return 1
        fi
    else
        echo -e "${GREEN}[DEPS] Dependencies are up to date${NC}"
    fi
}

# ==============================================================================
# MODULE 2: CONFIGURATION WIZARD
# ==============================================================================

generate_secret_key() {
    # Try multiple methods for generating a secure secret key
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    elif python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null; then
        return 0
    elif [ -f "/dev/urandom" ]; then
        head -c 32 /dev/urandom | base64 | tr -d '\n'
    else
        date +%s | sha256sum | base64 | head -c 64
    fi
}

run_config_wizard() {
    if [ -f "${ENV_FILE}" ]; then
        echo -e "${GREEN}[CONFIG] Loading existing configuration...${NC}"
        # Load .env variables
        set -a
        source "${ENV_FILE}" 2>/dev/null
        set +a
        
        # Validate required variables
        if [ -z "${PORT}" ]; then
            PORT=${PORT_DEFAULT}
        fi
        if [ -z "${SECRET_KEY}" ]; then
            SECRET_KEY=$(generate_secret_key)
            echo "SECRET_KEY=${SECRET_KEY}" >> "${ENV_FILE}"
        fi
        
        CURRENT_PORT=${PORT}
        return 0
    fi
    
    # First-run configuration wizard
    clear
    echo -e "${PURPLE}========================================${NC}"
    echo -e "${CYAN}        Dz-Core First Time Setup        ${NC}"
    echo -e "${PURPLE}========================================${NC}"
    echo ""
    
    # Get port
    read -p "$(echo -e "${YELLOW}Enter server port [${PORT_DEFAULT}]: ${NC}")" user_port
    if [ -z "${user_port}" ]; then
        user_port=${PORT_DEFAULT}
    fi
    
    # Validate port
    if ! [[ "${user_port}" =~ ^[0-9]+$ ]] || [ "${user_port}" -lt 1 ] || [ "${user_port}" -gt 65535 ]; then
        echo -e "${RED}Invalid port number. Using default ${PORT_DEFAULT}${NC}"
        user_port=${PORT_DEFAULT}
    fi
    
    # Generate secret key
    echo -e "${CYAN}Generating secure secret key...${NC}"
    secret_key=$(generate_secret_key)
    
    # Create .env file
    cat > "${ENV_FILE}" << EOF
# Dz-Core Configuration
# Generated on $(date)
PORT=${user_port}
SECRET_KEY=${secret_key}
FLASK_ENV=production
FLASK_APP=server.py
EOF
    
    echo -e "${GREEN}[CONFIG] Configuration saved to ${ENV_FILE}${NC}"
    echo -e "${YELLOW}[SECURITY] Your SECRET_KEY is: ${secret_key}${NC}"
    echo -e "${YELLOW}[SECURITY] Save this key in a secure location!${NC}"
    echo ""
    read -p "$(echo -e "${GREEN}Press Enter to continue...${NC}")"
    
    CURRENT_PORT=${user_port}
    export PORT=${user_port}
    export SECRET_KEY=${secret_key}
}

# ==============================================================================
# MODULE 3: SMART RUNNER
# ==============================================================================

check_port_available() {
    if command -v lsof >/dev/null 2>&1; then
        if lsof -Pi :"${CURRENT_PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then
            return 0  # Port is busy
        fi
    elif command -v netstat >/dev/null 2>&1; then
        if netstat -tuln | grep -q ":${CURRENT_PORT} "; then
            return 0  # Port is busy
        fi
    elif command -v ss >/dev/null 2>&1; then
        if ss -tuln | grep -q ":${CURRENT_PORT} "; then
            return 0  # Port is busy
        fi
    fi
    return 1  # Port is free
}

get_server_pid() {
    # First try to get PID from file
    if [ -f "${PID_FILE}" ]; then
        SERVER_PID=$(cat "${PID_FILE}" 2>/dev/null)
        # Verify the process is still running
        if [ -n "${SERVER_PID}" ] && kill -0 "${SERVER_PID}" 2>/dev/null; then
            return 0
        else
            # PID file exists but process is dead
            rm -f "${PID_FILE}"
            SERVER_PID=""
        fi
    fi
    
    # Fall back to port check
    if check_port_available; then
        if command -v lsof >/dev/null 2>&1; then
            SERVER_PID=$(lsof -t -i:"${CURRENT_PORT}" 2>/dev/null | head -1)
        fi
    fi
}

health_check() {
    local max_attempts=10
    local attempt=1
    local wait_time=2
    
    echo -e "${CYAN}[HEALTH] Waiting for server to start...${NC}"
    
    while [ ${attempt} -le ${max_attempts} ]; do
        if curl -s -f "http://127.0.0.1:${CURRENT_PORT}/health" >/dev/null 2>&1 || \
           curl -s -f "http://127.0.0.1:${CURRENT_PORT}/" >/dev/null 2>&1; then
            echo -e "${GREEN}[HEALTH] Server is responding on port ${CURRENT_PORT}${NC}"
            return 0
        fi
        
        echo -e "${YELLOW}[HEALTH] Attempt ${attempt}/${max_attempts}: Server not ready...${NC}"
        sleep ${wait_time}
        attempt=$((attempt + 1))
    done
    
    echo -e "${RED}[HEALTH] Server failed to start${NC}"
    if [ -f "${LOG_FILE}" ]; then
        echo -e "${YELLOW}[HEALTH] Last 10 lines of log:${NC}"
        tail -10 "${LOG_FILE}"
    fi
    return 1
}

start_server() {
    echo -e "${CYAN}[START] Initializing server startup...${NC}"
    
    # Check if port is available
    if check_port_available; then
        echo -e "${RED}[START] Port ${CURRENT_PORT} is already in use${NC}"
        get_server_pid
        if [ -n "${SERVER_PID}" ]; then
            echo -e "${YELLOW}[START] Process ${SERVER_PID} is using the port${NC}"
        fi
        return 1
    fi
    
    # Rotate logs if needed
    if [ -f "${LOG_FILE}" ] && [ $(stat -c%s "${LOG_FILE}" 2>/dev/null || stat -f%z "${LOG_FILE}" 2>/dev/null) -gt ${LOG_ROTATE_SIZE} ]; then
        echo -e "${YELLOW}[START] Rotating log file...${NC}"
        mv "${LOG_FILE}" "${LOG_FILE}.old"
    fi
    
    # Start server based on environment
    if [ "${IS_TERMUX}" = true ]; then
        echo -e "${GREEN}[START] Starting in Termux mode (background)...${NC}"
        echo -e "${CYAN}[START] Server output will be written to: ${LOG_FILE}${NC}"
        echo -e "${CYAN}[START] Access at: http://127.0.0.1:${CURRENT_PORT}${NC}"
        
        # Start server in background with nohup and save PID
        nohup python server.py > "${LOG_FILE}" 2>&1 &
        SERVER_PID=$!
        echo "${SERVER_PID}" > "${PID_FILE}"
        
        echo -e "${GREEN}[START] Server started with PID: ${SERVER_PID}${NC}"
        echo -e "${YELLOW}[START] You can now continue using the menu${NC}"
        
        # Run health check
        if health_check; then
            IS_RUNNING=true
        else
            stop_server
            return 1
        fi
    else
        echo -e "${GREEN}[START] Starting in Linux mode (production with gunicorn)...${NC}"
        
        if ! command -v gunicorn >/dev/null 2>&1; then
            echo -e "${YELLOW}[START] Gunicorn not found, installing...${NC}"
            pip install gunicorn
        fi
        
        # Start gunicorn in background
        gunicorn --workers=4 --bind=0.0.0.0:${CURRENT_PORT} --access-logfile=- --error-logfile="${LOG_FILE}" --daemon --pid="${PID_FILE}" server:app
        
        if [ $? -eq 0 ]; then
            SERVER_PID=$(cat "${PID_FILE}" 2>/dev/null)
            echo -e "${GREEN}[START] Server started with PID: ${SERVER_PID}${NC}"
            echo -e "${CYAN}[START] Access at: http://0.0.0.0:${CURRENT_PORT}${NC}"
            
            # Run health check
            if health_check; then
                IS_RUNNING=true
            else
                stop_server
                return 1
            fi
        else
            echo -e "${RED}[START] Failed to start server${NC}"
            return 1
        fi
    fi
}

stop_server() {
    echo -e "${CYAN}[STOP] Stopping server...${NC}"
    
    # Try to get PID from file first (works for both Termux and Linux)
    if [ -f "${PID_FILE}" ]; then
        SERVER_PID=$(cat "${PID_FILE}" 2>/dev/null)
        echo -e "${YELLOW}[STOP] Found PID from file: ${SERVER_PID}${NC}"
    fi
    
    # If no PID from file, try to get from port
    if [ -z "${SERVER_PID}" ]; then
        get_server_pid
    fi
    
    if [ -n "${SERVER_PID}" ]; then
        echo -e "${YELLOW}[STOP] Stopping process ${SERVER_PID}...${NC}"
        kill -TERM "${SERVER_PID}" 2>/dev/null
        
        # Wait for process to stop
        local max_wait=10
        local count=0
        while kill -0 "${SERVER_PID}" 2>/dev/null && [ ${count} -lt ${max_wait} ]; do
            sleep 1
            count=$((count + 1))
        done
        
        # Force kill if still running
        if kill -0 "${SERVER_PID}" 2>/dev/null; then
            echo -e "${YELLOW}[STOP] Force killing process ${SERVER_PID}...${NC}"
            kill -KILL "${SERVER_PID}" 2>/dev/null
        fi
        
        echo -e "${GREEN}[STOP] Process ${SERVER_PID} stopped${NC}"
    else
        echo -e "${YELLOW}[STOP] No PID found, trying to kill by port...${NC}"
        # Try to kill any process using the port
        if command -v fuser >/dev/null 2>&1; then
            fuser -k "${CURRENT_PORT}/tcp" 2>/dev/null
        fi
    fi
    
    # Remove PID file if exists
    if [ -f "${PID_FILE}" ]; then
        rm -f "${PID_FILE}"
    fi
    
    # Check if port is still in use
    if check_port_available; then
        echo -e "${RED}[STOP] Port ${CURRENT_PORT} is still in use${NC}"
        return 1
    fi
    
    IS_RUNNING=false
    SERVER_PID=""
    echo -e "${GREEN}[STOP] Server stopped successfully${NC}"
}

restart_server() {
    echo -e "${CYAN}[RESTART] Restarting server...${NC}"
    stop_server
    sleep 2
    start_server
}

# ==============================================================================
# MODULE 4: INTELLIGENT UPDATER
# ==============================================================================

check_internet() {
    if ping -c 1 -W 2 github.com >/dev/null 2>&1 || \
       curl -s --connect-timeout 5 https://github.com >/dev/null 2>&1; then
        return 0
    fi
    return 1
}

backup_database() {
    if [ ! -d "${BACKUP_DIR}" ]; then
        mkdir -p "${BACKUP_DIR}"
    fi
    
    if [ -f "${DB_FILE}" ]; then
        local backup_name="${BACKUP_DIR}/demonz_$(date +%Y%m%d_%H%M%S).db"
        cp "${DB_FILE}" "${backup_name}"
        echo -e "${GREEN}[BACKUP] Database backed up to: ${backup_name}${NC}"
        return 0
    else
        echo -e "${YELLOW}[BACKUP] No database file to backup${NC}"
        return 1
    fi
}

update_system() {
    echo -e "${CYAN}[UPDATE] Starting system update...${NC}"
    
    # Check internet
    if ! check_internet; then
        echo -e "${RED}[UPDATE] No internet connection. Update aborted.${NC}"
        return 1
    fi
    
    # Backup database
    backup_database
    
    # Check git status
    if [ -d ".git" ]; then
        # Check for local modifications
        if ! git diff-index --quiet HEAD -- 2>/dev/null; then
            echo -e "${YELLOW}[UPDATE] WARNING: You have uncommitted local changes${NC}"
            read -p "$(echo -e "${YELLOW}Continue anyway? (y/N): ${NC}")" confirm
            if [[ ! "${confirm}" =~ ^[Yy]$ ]]; then
                echo -e "${RED}[UPDATE] Update cancelled${NC}"
                return 1
            fi
        fi
        
        # Pull updates
        echo -e "${CYAN}[UPDATE] Pulling latest code...${NC}"
        if git pull; then
            echo -e "${GREEN}[UPDATE] Code updated successfully${NC}"
            
            # Update dependencies
            echo -e "${CYAN}[UPDATE] Updating dependencies...${NC}"
            if pip install -r "${REQUIREMENTS_FILE}"; then
                touch "${VENV_DIR}/.timestamp"
                echo -e "${GREEN}[UPDATE] Dependencies updated${NC}"
                
                # Offer restart if server is running
                get_server_pid
                if [ -n "${SERVER_PID}" ]; then
                    read -p "$(echo -e "${YELLOW}Restart server now? (y/N): ${NC}")" restart_confirm
                    if [[ "${restart_confirm}" =~ ^[Yy]$ ]]; then
                        restart_server
                    fi
                fi
            else
                echo -e "${RED}[UPDATE] Failed to update dependencies${NC}"
                return 1
            fi
        else
            echo -e "${RED}[UPDATE] Failed to pull updates${NC}"
            return 1
        fi
    else
        echo -e "${RED}[UPDATE] Not a git repository${NC}"
        return 1
    fi
}

# ==============================================================================
# MODULE 5: MAINTENANCE UTILITIES
# ==============================================================================

rotate_logs() {
    if [ -f "${LOG_FILE}" ]; then
        local log_size=$(stat -c%s "${LOG_FILE}" 2>/dev/null || stat -f%z "${LOG_FILE}" 2>/dev/null)
        if [ ${log_size} -gt ${LOG_ROTATE_SIZE} ]; then
            echo -e "${CYAN}[MAINT] Rotating log file (size: $(numfmt --to=iec ${log_size}))${NC}"
            mv "${LOG_FILE}" "${LOG_FILE}.$(date +%Y%m%d_%H%M%S)"
            echo -e "${GREEN}[MAINT] Log file rotated${NC}"
        else
            echo -e "${YELLOW}[MAINT] Log file size: $(numfmt --to=iec ${log_size}) (no rotation needed)${NC}"
        fi
    else
        echo -e "${YELLOW}[MAINT] No log file found${NC}"
    fi
}

factory_reset() {
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}         FACTORY RESET WARNING         ${NC}"
    echo -e "${RED}========================================${NC}"
    echo -e "${YELLOW}This will remove ALL configuration and data:${NC}"
    echo -e "  • ${RED}Virtual environment (.venv)${NC}"
    echo -e "  • ${RED}Configuration (.env)${NC}"
    echo -e "  • ${RED}Database (demonz.db)${NC}"
    echo -e "  • ${RED}Server logs${NC}"
    echo ""
    read -p "$(echo -e "${RED}Type 'RESET' to confirm: ${NC}")" confirmation
    
    if [ "${confirmation}" != "RESET" ]; then
        echo -e "${GREEN}[RESET] Cancelled${NC}"
        return
    fi
    
    # Stop server if running
    get_server_pid
    if [ -n "${SERVER_PID}" ]; then
        stop_server
    fi
    
    # Remove files
    echo -e "${CYAN}[RESET] Removing configuration and data...${NC}"
    [ -d "${VENV_DIR}" ] && rm -rf "${VENV_DIR}" && echo "Removed .venv"
    [ -f "${ENV_FILE}" ] && rm -f "${ENV_FILE}" && echo "Removed .env"
    [ -f "${DB_FILE}" ] && rm -f "${DB_FILE}" && echo "Removed demonz.db"
    [ -f "${PID_FILE}" ] && rm -f "${PID_FILE}" && echo "Removed .pid"
    [ -f "${LOG_FILE}" ] && rm -f "${LOG_FILE}" && echo "Removed server.log"
    [ -f "${LOG_FILE}.old" ] && rm -f "${LOG_FILE}.old" && echo "Removed old logs"
    
    echo -e "${GREEN}[RESET] Factory reset complete${NC}"
    echo -e "${YELLOW}[RESET] Restart the script to run first-time setup${NC}"
    exit 0
}

view_logs() {
    if [ -f "${LOG_FILE}" ]; then
        echo -e "${CYAN}[LOGS] Showing last 20 lines (Ctrl+C to exit):${NC}"
        echo -e "${YELLOW}----------------------------------------${NC}"
        trap 'echo -e "\n${GREEN}[LOGS] Log view exited${NC}"' INT
        tail -f -n 20 "${LOG_FILE}"
        trap - INT
    else
        echo -e "${YELLOW}[LOGS] No log file found${NC}"
        read -p "Press Enter to continue..."
    fi
}

# ==============================================================================
# MODULE 6: UI/UX & MENU
# ==============================================================================

show_banner() {
    clear
    echo -e "${PURPLE}"
    cat << "EOF"
██████╗ ███████╗    ██████╗ ██████╗ ██████╗ ███████╗
██╔══██╗╚══███╔╝   ██╔════╝██╔═══██╗██╔══██╗██╔════╝
██║  ██║  ███╔╝    ██║     ██║   ██║██████╔╝█████╗  
██║  ██║ ███╔╝     ██║     ██║   ██║██╔══██╗██╔══╝  
██████╔╝███████╗██╗╚██████╗╚██████╔╝██║  ██║███████╗
╚═════╝ ╚══════╝╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝
EOF
    echo -e "${NC}"
    echo -e "${CYAN}        Production Cloud Manager${NC}"
    echo -e "${BLUE}        https://github.com/sdemonzdevelopment-spec/Dz-Core${NC}"
    echo -e "${WHITE}========================================${NC}"
}

show_status() {
    get_server_pid
    local status_color=$RED
    local status_text="OFFLINE"
    
    if [ -n "${SERVER_PID}" ]; then
        if kill -0 "${SERVER_PID}" 2>/dev/null; then
            status_color=$GREEN
            status_text="ONLINE"
            IS_RUNNING=true
        fi
    else
        IS_RUNNING=false
    fi
    
    echo -e "${WHITE} Status: ${status_color}${status_text}${NC}"
    echo -e "${WHITE} Port: ${YELLOW}${CURRENT_PORT}${NC}"
    echo -e "${WHITE} Mode: ${YELLOW}${ENV_TYPE}${NC}"
    echo -e "${WHITE}----------------------------------------${NC}"
}

show_menu() {
    echo -e "${BOLD}COMMAND CENTER:${NC}"
    echo -e "  1) ${GREEN}Start Server${NC}      - Launch Dz-Core"
    echo -e "  2) ${RED}Stop Server${NC}       - Graceful shutdown"
    echo -e "  3) ${YELLOW}Restart Server${NC}    - Hot reload"
    echo -e "  4) ${CYAN}Live Logs${NC}        - Real-time monitoring"
    echo -e "  5) ${BLUE}Update System${NC}     - Git pull & dependencies"
    echo -e "  6) ${PURPLE}Maintenance${NC}      - Log rotation & tools"
    echo -e "  7) ${WHITE}Exit${NC}"
    echo ""
}

maintenance_menu() {
    while true; do
        clear
        echo -e "${CYAN}========================================${NC}"
        echo -e "${CYAN}          MAINTENANCE MENU             ${NC}"
        echo -e "${CYAN}========================================${NC}"
        echo ""
        echo -e "  1) ${YELLOW}Rotate Logs${NC}      - Manage log files"
        echo -e "  2) ${BLUE}Backup Database${NC}   - Create DB backup"
        echo -e "  3) ${RED}Factory Reset${NC}     - Wipe all data (DANGER)"
        echo -e "  4) ${WHITE}Return to Main Menu${NC}"
        echo ""
        read -p "$(echo -e "${CYAN}Selection > ${NC}")" maint_opt
        
        case ${maint_opt} in
            1) rotate_logs ;;
            2) backup_database ;;
            3) factory_reset ;;
            4) return 0 ;;
            *) echo -e "${RED}Invalid option${NC}"; sleep 1 ;;
        esac
        
        if [ ${maint_opt} -ne 4 ]; then
            read -p "$(echo -e "${GREEN}Press Enter to continue...${NC}")"
        fi
    done
}

# ==============================================================================
# MAIN EXECUTION FLOW
# ==============================================================================

main() {
    # Initial setup
    detect_environment
    setup_virtualenv || exit 1
    install_dependencies || exit 1
    run_config_wizard
    
    # Main loop
    while true; do
        show_banner
        show_status
        show_menu
        
        read -p "$(echo -e "${CYAN}Selection > ${NC}")" option
        
        case ${option} in
            1)
                if ${IS_RUNNING}; then
                    echo -e "${YELLOW}Server is already running${NC}"
                else
                    start_server
                fi
                ;;
            2)
                if ${IS_RUNNING}; then
                    stop_server
                else
                    echo -e "${YELLOW}Server is not running${NC}"
                fi
                ;;
            3)
                if ${IS_RUNNING}; then
                    restart_server
                else
                    echo -e "${YELLOW}Starting server...${NC}"
                    start_server
                fi
                ;;
            4) view_logs ;;
            5) update_system ;;
            6) maintenance_menu ;;
            7)
                echo -e "${GREEN}Shutting down...${NC}"
                if ${IS_RUNNING}; then
                    stop_server
                fi
                exit 0
                ;;
            *)
                echo -e "${RED}Invalid selection${NC}"
                sleep 1
                ;;
        esac
        
        if [ ${option} -ne 4 ] && [ ${option} -ne 6 ]; then
            read -p "$(echo -e "${GREEN}Press Enter to continue...${NC}")"
        fi
    done
}

# Graceful exit handler
trap 'echo -e "\n${YELLOW}Received interrupt, shutting down...${NC}"; stop_server; exit 0' INT TERM

# Entry point
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi
