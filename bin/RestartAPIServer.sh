cd ~/alphaverse-xrp/
screen -S apiserver -X quit
screen -dmS apiserver && apiserver -S server -X stuff 'cd ~/alphaverse-xrp && npm run apiServer\n'
sleep 1
exit

