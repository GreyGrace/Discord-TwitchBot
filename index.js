const config = require('./config.json');

const axios = require('axios');

const Discord = require('discord.js');
const client = new Discord.Client();
global.discordJsClient = client;

//441xg89jnaxl3tntjjvdmxngz40xdn
//7tds464wuyv806kc4fs6mc21104ob5

const TwitchMonitor = require("./twitch-monitor");
const FooduseMonitor = require("./fooduse-monitor");
const DiscordChannelSync = require("./discord-channel-sync");
const LiveEmbed = require('./live-embed');
const MiniDb = require('./minidb');

// --- Startup ---------------------------------------------------------------------------------------------------------
console.log('Tatsuo is starting.');

// --- Discord ---------------------------------------------------------------------------------------------------------
console.log('Conectando a Discord...');

let targetChannels = [];
let emojiCache = { };

let getServerEmoji = (emojiName, asText) => {
    if (typeof emojiCache[emojiName] !== "undefined") {
        return emojiCache[emojiName];
    }

    try {
        let emoji = client.emojis.cache.find(e => e.name === emojiName);

        if (emoji) {
            emojiCache[emojiName] = emoji;

            if (asText) {
                return emoji.toString();
            } else {
                return emoji.id;
            }
        }
    } catch (e) {
        console.error(e);
    }

    return null;
};
global.getServerEmoji = getServerEmoji;

let syncServerList = (logMembership) => {
    targetChannels = DiscordChannelSync.getChannelList(client, config.discord_announce_channel, logMembership);
};

client.on('ready', () => {
    console.log('[Discord]', `Bot esta listo; loggeado como ${client.user.tag}.`);

    syncServerList(true);

    StreamActivity.init(client);

    TwitchMonitor.start();

    FooduseMonitor.start();
});

client.on("guildCreate", guild => {
    console.log(`[Discord]`, `Se unio a nuevo server: ${guild.name}`);

    syncServerList(false);
});

client.on("guildDelete", guild => {
    console.log(`[Discord]`, `Fue removido del server: ${guild.name}`);

    syncServerList(false);
});


console.log('[Discord]', 'Loggeando...');
client.login(config.discord_bot_token);

// Activity updater
class StreamActivity {

    static setChannelOnline(stream) {
        this.onlineChannels[stream.user_name] = stream;

        this.updateActivity();
    }

    static setChannelOffline(stream) {
        delete this.onlineChannels[stream.user_name];

        this.updateActivity();
    }

    static getMostRecentStreamInfo() {
        let lastChannel = null;
        for (let channelName in this.onlineChannels) {
            if (typeof channelName !== "undefined" && channelName) {
                lastChannel = this.onlineChannels[channelName];
            }
        }
        return lastChannel;
    }

    static updateActivity() {
        let streamInfo = this.getMostRecentStreamInfo();

        if (streamInfo) {
            this.discordClient.user.setActivity(streamInfo.user_name, {
                "url": `https://twitch.tv/${streamInfo.user_name.toLowerCase()}`,
                "type": "STREAMING"
            });

            console.log('[StreamActivity]', `Actualizando actividad     reciente: viendo ${streamInfo.user_name}.`);
        } else {
            console.log('[StreamActivity]', 'Limpiando actividad reciente');

            this.discordClient.user.setActivity(null);
        }
    }

    static init(discordClient) {
        this.discordClient = discordClient;
        this.onlineChannels = { };

        this.updateActivity();

        setInterval(this.updateActivity.bind(this), 5 * 60 * 1000);
    }
}



let liveMessageDb = new MiniDb('live-messages');
let messageHistory = liveMessageDb.get("messagelog") || { };

TwitchMonitor.onChannelLiveUpdate((streamData) => {
    const isLive = streamData.type === "live";

    try {
        syncServerList(false);
    } catch (e) { }

    StreamActivity.setChannelOnline(streamData);

    const msgFormatted = `${streamData.user_name} esta en vivo en Twitch!`;
    const msgEmbed = LiveEmbed.createForStream(streamData);

    let anySent = false;

    for (let i = 0; i < targetChannels.length; i++) {
        const discordChannel = targetChannels[i];
        const liveMsgDiscrim = `${discordChannel.guild.id}_${discordChannel.name}_${streamData.id}`;

        if (discordChannel) {
            try {

                let existingMsgId = messageHistory[liveMsgDiscrim] || null;

                if (existingMsgId) {

                    discordChannel.messages.fetch(existingMsgId)
                      .then((existingMsg) => {
                        existingMsg.edit(msgFormatted, {
                          embed: msgEmbed
                        }).then((message) => {

                          if (!isLive) {
                            delete messageHistory[liveMsgDiscrim];
                            liveMessageDb.put('messagelog', messageHistory);
                          }
                        });
                      })
                      .catch((e) => {

                        if (e.message === "Mensaje desconocido") {

                            delete messageHistory[liveMsgDiscrim];
                            liveMessageDb.put('messagelog', messageHistory);

                        }
                      });
                } else {

                    if (!isLive) {

                        continue;
                    }

                    let mentionMode = (config.discord_mentions && config.discord_mentions[streamData.user_name.toLowerCase()]) || null;

                    if (mentionMode) {
                        mentionMode = mentionMode.toLowerCase();

                        if (mentionMode === "everyone" || mentionMode === "here") {
                            // Reserved @ keywords for discord that can be mentioned directly as text
                            mentionMode = `@${mentionMode}`;
                        } else {
                            // Most likely a role that needs to be translated to <@&id> format
                            let roleData = discordChannel.guild.roles.cache.find((role) => {
                                return (role.name.toLowerCase() === mentionMode);
                            });

                            if (roleData) {
                                mentionMode = `<@&${roleData.id}>`;
                            } else {
                                console.log('[Discord]', `No puede mencionar a rol: ${mentionMode}`,
                                  `(no existe en este ${discordChannel.guild.name})`);
                                mentionMode = null;
                            }
                        }
                    }

                    let msgToSend = msgFormatted;

                    if (mentionMode) {
                        msgToSend = msgFormatted + ` ${mentionMode}`
                    }

                    let msgOptions = {
                        embed: msgEmbed
                    };

                    discordChannel.send(msgToSend, msgOptions)
                        .then((message) => {
                            console.log('[Discord]', `anuncio mandado a${discordChannel.name} en ${discordChannel.guild.name}`)

                            messageHistory[liveMsgDiscrim] = message.id;
                            liveMessageDb.put('messagelog', messageHistory);
                        })
                        .catch((err) => {
                            console.log('[Discord]', `no se pudo mandar mensaje #${discordChannel.name} en ${discordChannel.guild.name}: manda a chinga a Edgardo.`, err.message);
                        });
                }

                anySent = true;
            } catch (e) {
                console.warn('[Discord]', 'Problema al enviar mensaje:', e);
            }
        }
    }

    liveMessageDb.put('messagelog', messageHistory);
    return anySent;
});

TwitchMonitor.onChannelOffline((streamData) => {
    StreamActivity.setChannelOffline(streamData);
});

String.prototype.replaceAll = function(search, replacement) {
    var target = this;
    return target.split(search).join(replacement);
};

String.prototype.spacifyCamels = function () {
    let target = this;

    try {
        return target.replace(/([a-z](?=[A-Z]))/g, '$1 ');
    } catch (e) {
        return target;
    }
};

Array.prototype.joinEnglishList = function () {
    let a = this;

    try {
        return [a.slice(0, -1).join(', '), a.slice(-1)[0]].join(a.length < 2 ? '' : ' and ');
    } catch (e) {
        return a.join(', ');
    }
};

String.prototype.lowercaseFirstChar = function () {
    let string = this;
    return string.charAt(0).toUpperCase() + string.slice(1);
};

Array.prototype.hasEqualValues = function (b) {
    let a = this;

    if (a.length !== b.length) {
        return false;
    }

    a.sort();
    b.sort();

    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }

    return true;
}