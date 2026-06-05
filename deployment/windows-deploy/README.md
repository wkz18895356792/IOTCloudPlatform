# BabyMonitor Windows Server Deployment Guide

## Overview

This is a complete Windows server deployment solution for the BabyMonitor platform that does not use Docker or deploy source code.

## Features

- No Docker required
- Only compiled code is deployed
- PM2 for process management
- Automatic startup on boot
- Rolling updates support
- Log management

## Directory Structure
```
deployment/windows-deploy/
├── build-for-deploy.ps1      # Build all services
├── package-release.ps1       # Package for deployment
├── install-dependencies.ps1  # Install dependencies (run on server)
├── ecosystem.config.js       # PM2 configuration
├── start-services.ps1        # Start services
├── stop-services.ps1         # Stop services
├── restart-services.ps1      # Restart services
├── status.ps1                # View status
├── logs.ps1                  # View logs
├── update-service.ps1        # Update single service
└── README.md                 # This file
```

## Deployment Process
```
+-------------------+       +-------------------+
|  Development       |       |  Windows Server    |
|  Machine           |       |                   |
+-------------------+       +-------------------+
        |                             |
        | 1. build-for-deploy.ps1   |
        | 2. package-release.ps1    |
        |                             |
        v                             v
        |  Copy zip file             |
        v                             |
+-------------------+       +-------------------+
|  Development       |       |  Windows Server    |
|  Machine           |       |                   |
+-------------------+       +-------------------+
                                    |
                                    | 3. Extract zip
                                    | 4. Configure .env
                                    | 5. install-dependencies.ps1
                                    | 6. start-services.ps1
                                    |
                                    v
                            +------------------+
                            |  Services       |
                            |  Running        |
                            +------------------+
```

## Step 1: Build on Development Machine

```powershell
cd deployment\windows-deploy
.\build-for-deploy.ps1
```

Options:
- `-Services @("api-gateway", "user-service")` - Build specific services only
- `-SkipInstall` - Skip npm install step

## Step 2: Package for Deployment

```powershell
.\package-release.ps1 -Version "1.0.0"
```

Options:
- `-Version "1.0.0"` - Specify version number
- `-IncludeNodeModules:$false` - Skip node_modules (install on server)

## Step 3: Deploy to Server

1. Copy the generated zip file to the server
2. Extract to deployment directory (e.g., C:\babymonitor)
3. Copy `.env.example` to `.env` and configure

## Step 4: Install Dependencies (on Server)

```powershell
.\install-dependencies.ps1
```

## Step 5: Start Services

```powershell
.\start-services.ps1
```

## Server Requirements

| Software | Version | Purpose |
|----------|---------|---------|
| Node.js | 18+ LTS | Runtime environment |
| MySQL | 8.0 | Database |
| Redis | 7 | Cache |
| EMQX | 5.4.0 | MQTT Broker |
| PM2 | Global | Process manager |

## Environment Variables

Copy `.env.example` to `.env` and configure:

```ini
# Environment
NODE_ENV=production

# MySQL
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE=babymonitor
MYSQL_USER=babymonitor_user
MYSQL_PASSWORD=your_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password

# EMQX MQTT
MQTT_HOST=localhost
MQTT_PORT=1883

# JWT Secret (64+ characters)
JWT_SECRET=your_jwt_secret_here_minimum_64_characters_long

# Device Secret (64+ characters)
DEVICE_SECRET=your_device_secret_here_minimum_64_characters_long

# Service API Key (64+ characters)
SERVICE_API_KEY=your_service_api_key_here_minimum_64_characters_long

# Service URLs (localhost for local deployment)
USER_SERVICE_URL=http://localhost:6002
DEVICE_SERVICE_URL=http://localhost:6003
BABY_SERVICE_URL=http://localhost:6008
DEVICE_GATEWAY_URL=http://localhost:6010
STORAGE_SERVICE_URL=http://localhost:6005
STREAM_SERVICE_URL=http://localhost:6004
ADMIN_SERVICE_URL=http://localhost:6009
```

## Service Ports

| Service | Port | Description |
|---------|------|-------------|
| api-gateway | 6001 | API Gateway |
| user-service | 6002 | User Service |
| device-service | 6003 | Device Service |
| video-service | 6004 | Video Service |
| storage-service | 6005 | Storage Service |
| baby-service | 6008 | Baby Service |
| admin-service | 6009 | Admin Service |
| device-gateway | 6010 | Device Gateway |

## Common Commands

### Development Machine
```powershell
# Build all services
.\build-for-deploy.ps1

# Package for release
.\package-release.ps1 -Version "1.0.0"
```

### Server
```powershell
# Install dependencies
.\install-dependencies.ps1

# Start services
.\start-services.ps1

# View status
.\status.ps1

# View logs
.\logs.ps1

# Stop services
.\stop-services.ps1

# Restart services
.\restart-services.ps1
```

### PM2 Commands
```bash
pm2 list                    # View all processes
pm2 logs                    # View all logs
pm2 logs api-gateway        # View specific service logs
pm2 monit                   # Monitor panel
pm2 restart all             # Restart all services
pm2 stop all                # Stop all services
pm2 delete all              # Delete all processes
pm2 save                    # Save process list
pm2 resurrect               # Restore process list
pm2 startup                 # Configure auto-start
```

## Troubleshooting

### Service Won't Start
1. Check logs: `pm2 logs <service-name>`
2. Check port usage: `netstat -ano | findstr "6001"`
3. Check environment variables: Ensure `.env` file exists and is correct
4. Check database connection: Ensure MySQL/Redis services are running
5. Check MQTT connection: Ensure EMQX service is running

### Database Connection Failed
1. Ensure MySQL service is running
2. Check `MYSQL_HOST` and `MYSQL_PORT` configuration
3. Verify username and password
4. Check firewall settings

### Redis Connection Failed
1. Ensure Redis service is running
2. Check `REDIS_HOST` and `REDIS_PORT` configuration
3. Verify Redis password
4. Ensure Redis allows remote connections

### MQTT Connection Failed
1. Ensure EMQX service is running
2. Check `MQTT_HOST` and `MQTT_PORT` configuration
3. Check firewall settings

## Security Recommendations
1. **Change all default passwords** - Database, Redis, EMQX, etc.
2. **Generate secure keys** - JWT_SECRET, DEVICE_SECRET, SERVICE_API_KEY (64+ characters)
3. **Configure firewall** - Only expose necessary ports
4. **Regular backups** - Database and configuration files
5. **Enable HTTPS** - Recommended for production
6. **Restrict remote access** - Database and Redis should only allow localhost

## Update Process
1. Build new version on development machine
2. Run `.\package-release.ps1 -Version "new-version"`
3. Copy the new zip file to server
4. Run `.\update-service.ps1 -Service <service-name>` to update individual services

## Rollback
If an update causes issues, rollback to previous version:
```powershell
# Check backup directory
dir <service-directory>.backup.*

# Restore from backup
Copy-Item -Path "<backup-path>" -Destination "<service-directory>" -Recurse -Force
pm2 restart <service-name>
```

## Support
For issues, please contact the development team.
