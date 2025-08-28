cd ~/alphaverse-xrp/
screen -S getIPs -X quit
screen -dmS getIPs && screen -S getIPs -X stuff 'cd ~/alphaverse-xrp && npm run getIPs\n'
sleep 1
exit