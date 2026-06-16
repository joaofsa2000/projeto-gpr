sudo apt update && sudo apt upgrade -y
sudo apt install nodejs npm -y


mkdir servidor-api
cd servidor-api
npm init -y

npm install express sqlite3

nano server.js

node server.js

# configurar pm2
sudo npm install -g pm2
pm2 start server.js --name "servidor-http"

pm2 startup

pm2 save