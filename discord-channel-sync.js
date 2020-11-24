/**
 * Helper class for syncing discord target channels.
 */
class DiscordChannelSync {
    /**
     * @param {Client} client Discord.js client.
     * @param {string} channelName Name of the Discord channel we are looking for on each server (e.g. `config.discord_announce_channel`).
     * @param {boolean} verbose If true, log guild membership info to stdout (debug / info purposes).
     * @return {Channel[]} List of Discord.js channels
     */
    static getChannelList(client, channelName, verbose) {
        let nextTargetChannels = [];

        client.guilds.cache.forEach((guild) => {
            let targetChannel = guild.channels.cache.find(g => g.name === channelName);

            if (!targetChannel) {
                if (verbose) {
                    console.warn('[Discord]', 'Problema de configuracion /!\\', `Server ${guild.name} no tiene canal #${channelName} !`);
                }
            } else {
                let permissions = targetChannel.permissionsFor(guild.me);

                if (verbose) {
                    console.log('[Discord]', ' --> ', `Server ${guild.name}, esta configurado para el canal #${targetChannel.name}`);
                }

                if (!permissions.has("SEND_MESSAGES")) {
                    if (verbose) {
                        console.warn('[Discord]', 'Permission problem /!\\', `I do not have SEND_MESSAGES permission on channel #${targetChannel.name} on ${guild.name}: announcement sends will fail.`);
                    }
                }

                nextTargetChannels.push(targetChannel);
            }
        });

        if (verbose) {
            console.log('[Discord]', `Descubrio ${nextTargetChannels.length} tiene canales para anunciar el stream en: ${channelName}.`);
        }

        return nextTargetChannels;
    }
}

module.exports = DiscordChannelSync;
