# Git 部署说明

这份文档适合当前这个项目的使用方式：

- 本地开发机器：`/Users/zmd/work/work-file-archive`
- 线上服务器项目目录：`/opt/work-file-archive`
- GitHub 仓库：`https://github.com/0829menghui/work-file-archive.git`
- 线上访问地址：`http://124.223.78.223/work-file-archive/`
- 线上服务器：`ubuntu@124.223.78.223`
- 服务器系统：`Ubuntu`
- 前端：`React + Vite`
- 后端：`FastAPI + systemd + nginx`

## 为什么推荐 Git

不用再反复：

- `scp` 单个文件
- 手动覆盖服务器文件
- 记不清哪些文件改过

改成 Git 之后，日常更新会简单很多：

1. 本地改代码
2. `git add` + `git commit`
3. `git push`
4. 服务器 `git fetch + reset --hard`
5. 执行部署脚本

## 当前状态

这套 Git 基础已经准备好了：

- 本地项目已经初始化为独立 Git 仓库
- 默认分支是 `main`
- 远程 `origin` 已经配置到：

```bash
https://github.com/0829menghui/work-file-archive.git
```

- 项目里已经准备好了：
  - [deploy.sh](./deploy.sh)
  - [publish.sh](./publish.sh)

## 一次性准备

### 1. 本地初始化 Git 仓库

如果你是从零开始搭新环境，可以在本地项目根目录执行：

```bash
cd /Users/zmd/work/work-file-archive
git init
git branch -M main
git add .
git commit -m "init work file archive"
```

### 2. 创建远程仓库

GitHub 仓库地址：

```bash
https://github.com/0829menghui/work-file-archive.git
```

创建好仓库后，把远程地址加进来：

```bash
cd /Users/zmd/work/work-file-archive
git remote add origin https://github.com/0829menghui/work-file-archive.git
git branch -M main
git push -u origin main
```

### 3. 服务器改成通过 Git 拉代码

先登录服务器：

```bash
ssh ubuntu@124.223.78.223
```

如果服务器上已经有 `/opt/work-file-archive`，先备份一下：

```bash
sudo mv /opt/work-file-archive /opt/work-file-archive.bak
```

然后重新拉仓库：

```bash
cd /opt
sudo git clone https://github.com/0829menghui/work-file-archive.git work-file-archive
sudo chown -R ubuntu:ubuntu /opt/work-file-archive
```

## 服务器首次部署

### 0. 第一次修复 Git 目录权限

如果服务器上出现过这类报错：

```bash
fatal: detected dubious ownership in repository at '/opt/work-file-archive'
```

先在服务器执行一次：

```bash
git config --global --add safe.directory /opt/work-file-archive
sudo chown -R ubuntu:ubuntu /opt/work-file-archive
```

### 1. 安装后端依赖

```bash
cd /opt/work-file-archive/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. 构建前端

```bash
cd /opt/work-file-archive/frontend
npm ci
npm run build
```

### 3. 配置 systemd

线上后端服务名：

```text
work-file-archive
```

服务文件位置：

```text
/etc/systemd/system/work-file-archive.service
```

后端监听：

```text
127.0.0.1:8010
```

修改服务后需要执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable work-file-archive
sudo systemctl restart work-file-archive
```

### 4. 配置 nginx

当前项目挂在服务器子路径下：

```text
http://124.223.78.223/work-file-archive/
```

nginx 需要把这些路径转到新项目：

- `/work-file-archive/`: 前端静态资源
- `/work-file-archive/api/`: 后端 API

项目根目录里已经放好一个参考配置文件：

- [nginx.work-file-archive.conf](./nginx.work-file-archive.conf)

它的含义是：

- 旧项目 `requirement-archive` 继续占用根路径 `/`
- 当前项目 `work-file-archive` 单独挂在 `/work-file-archive/`

修改 nginx 后执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 5. 检查服务状态

```bash
sudo systemctl status work-file-archive
sudo systemctl status nginx
```

## 日常更新流程

### 本地执行

```bash
cd /Users/zmd/work/work-file-archive
bash publish.sh "feat: 更新工作文件归档"
```

`publish.sh` 会自动完成：

1. `git add .`
2. 如果有改动则提交
3. `git push origin main`
4. 打包当前分支
5. 通过 SSH 上传到服务器
6. 服务器拉取并执行 `deploy.sh`

### 服务器执行

如果你只想在服务器手动部署：

```bash
ssh ubuntu@124.223.78.223
cd /opt/work-file-archive
bash deploy.sh
```

## 脚本说明

项目里已经准备好了两个脚本：

- [deploy.sh](./deploy.sh): 放在服务器项目根目录执行，负责 `git fetch + reset --hard + 安装依赖 + build + 重启服务`
- [publish.sh](./publish.sh): 在本地执行，负责 `git commit + git push + 远程触发 deploy.sh`
- [upload_deploy_restart.sh](./upload_deploy_restart.sh): 本地一键上传、部署并重启服务，内部调用 `publish.sh`
- [restart_server.sh](./restart_server.sh): 本地一键重启服务器上的后端服务和 nginx

### 一键上传、部署、重启

本地执行：

```bash
cd /Users/zmd/work/work-file-archive
bash upload_deploy_restart.sh "feat: 更新说明"
```

等价于执行：

```bash
bash publish.sh "feat: 更新说明"
```

### 只重启服务器服务

如果代码没有变化，只想重启服务：

```bash
cd /Users/zmd/work/work-file-archive
bash restart_server.sh
```

### `publish.sh` 默认配置

```text
服务器：ubuntu@124.223.78.223
项目目录：/opt/work-file-archive
分支：main
GitHub 仓库：https://github.com/0829menghui/work-file-archive.git
```

如果后面换服务器，也可以临时指定：

```bash
REMOTE_HOST="ubuntu@你的服务器IP" bash publish.sh "chore: deploy"
```

## 默认账号

```text
用户名：admin
密码：admin123
```

上线后建议第一时间修改管理员密码，或者在 systemd 环境变量里改默认密码：

```text
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=请改成强密码
```

## 数据目录

线上数据保存在：

```text
/opt/work-file-archive/backend/data/work_file_archive.db
/opt/work-file-archive/backend/data/storage/
```

请定期备份：

```bash
tar -czf work-file-archive-data-$(date +%Y%m%d).tar.gz /opt/work-file-archive/backend/data
```

## 你现在最推荐的用法

对你当前这个项目，我建议固定成这套：

1. 本地改完代码后执行一键发布脚本
2. 脚本自动推送 GitHub
3. 脚本自动触发服务器部署
4. 服务器自动构建前端并重启后端服务和 nginx

如果你只想记一条，那就记这个：

```bash
cd /Users/zmd/work/work-file-archive
bash upload_deploy_restart.sh "feat: 你的更新说明"
```

它会一次性完成：

1. 本地 `git add`
2. 本地 `git commit`
3. 本地 `git push`
4. 上传当前分支 bundle 到服务器
5. 服务器执行 `deploy.sh`
6. 重启 `work-file-archive` 和 `nginx`

## 你日常就用这三条（一键版）

### 1. 本地一键上传并触发服务器部署

```bash
cd /Users/zmd/work/work-file-archive
bash upload_deploy_restart.sh "feat: 你的更新说明"
```

### 2. 服务器一键拉取并重启

```bash
ssh ubuntu@124.223.78.223 "cd /opt/work-file-archive && bash deploy.sh"
```

### 3. 本地一键重启服务器服务

```bash
cd /Users/zmd/work/work-file-archive
bash restart_server.sh
```

`upload_deploy_restart.sh` 负责本地 `git add`、`git commit`、`git push`，并远程触发 `deploy.sh`。  
`deploy.sh` 负责服务器 `git fetch + reset --hard`、安装依赖、构建前端和重启服务。  
`restart_server.sh` 负责只重启服务器上的 `work-file-archive` 和 `nginx`。
