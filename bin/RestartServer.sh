cd ~/alphaverse-xrp/
screen -S server -X quit
sleep 1
screen -dmS server && screen -S server -X stuff 'cd ~/alphaverse-xrp && npm run server\n'
exit
