sudo apt update && sudo apt upgrade -y
sudo apt install nodejs npm -y

para correr a aplicação:

npm install express sqlite3

node index.js

# configurar pm2
sudo npm install -g pm2
pm2 start index.js --name "fleet-manager"

pm2 startup

pm2 save