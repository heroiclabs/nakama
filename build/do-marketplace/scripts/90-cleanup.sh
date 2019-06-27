#!/bin/bash

rm -rf /tmp/* /var/tmp/*
history -c
cat /dev/null > /root/.bash_history
unset HISTFILE

apt-get -y autoremove
apt-get -y autoclean

find /var/log -mtime -1 -type f -exec truncate -s 0 {} \;
rm -rf /var/log/*.gz /var/log/*.[0-9] /var/log/*-???????? /var/log/*.log
rm -rf /var/lib/cloud/instances/*
rm -rf /var/lib/cloud/instance

rm -f /root/.ssh/authorized_keys /etc/ssh/*key*

dd if=/dev/zero of=/zerofile; sync; rm /zerofile; sync
cat /dev/null > /var/log/lastlog; cat /dev/null > /var/log/wtmp; cat /dev/null > /var/log/auth.log
