screen -S client -X quit
sleep 1
cd /mnt/alphaverse-xrp/
screen -dmS client && screen -S client -X stuff 'npm run client\n'
exit