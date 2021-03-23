const {Collection} = require("discord.js");
const {Op} = require("sequelize");

const config = require("../config.json");
const {reactionCooldowns, ignoreReactions, lastUpdate} = require("./globals");
const {users, roles, emojis} = require("./database");
const {stringFromEmoji} = require("./parser");
const {DatabaseError} = require("./errortypes");

module.exports = async (reaction, user, increment = true) => {
    const message = reaction.message;

    // Check if bot should listen to the emoji
    const row = await emojis.findOne({
        where: {guild: message.guild.id, emoji: stringFromEmoji(reaction.emoji)},
        attributes: ["emoji"]
    });

    if (!row) {
        // Ignore reaction
        return;
    }

    const ignoreGuild = ignoreReactions.get(message.guild.id);

    // Check if reaction should get ignored
    if (!increment && ignoreGuild && ignoreGuild.includes(message.id)) {
        // Delete entry from cache
        const index = ignoreGuild.findIndex(i => i === message.id);
        return ignoreGuild.splice(index, 1);
    }

    // Score increasing/decreasing reaction

    // Check for timeout if it's an increment
    if (increment) {
        const now = Date.now();

        // Check for cooldown
        let reactionGuild = reactionCooldowns.get(message.guild.id);
        if (reactionGuild) {
            const expirationTime = reactionGuild.get(user.id);
            // This is probably always true, because expired cooldowns should get removed automatically
            if (expirationTime && now < expirationTime) {
                // Add message to ignored message, so removal event will get ignored
                let ignoreGuild = ignoreReactions.get(message.guild.id);
                if (!ignoreGuild) {
                    ignoreGuild = [];
                    ignoreReactions.set(message.guild.id, ignoreGuild);
                }

                ignoreGuild.push(message.id);

                // Remove reaction
                return reaction.users.remove(user);
            }
        }

        // Update cooldown
        if (!reactionGuild) {
            reactionGuild = new Collection();
            reactionCooldowns.set(message.guild.id, reactionGuild);
        }

        const currentCooldown = config.reaction_cooldown * 1000;
        reactionGuild.set(user.id, now + currentCooldown);

        // Remove cooldown from collection when expired
        setTimeout(() => reactionGuild.delete(user.id), currentCooldown);
    }

    // Get entry of user
    const userRow = await users.findOrCreate({
        where: {guild: message.guild.id, user: message.author.id}
    });

    // Check if user has an entry
    if (!userRow || userRow.length < 1) {
        throw new DatabaseError(`Could not find or create an entry for the user ${user.tag}`);
    }

    // Update score
    if (increment) {
        await userRow[0].increment({reactions: 1});
    } else {
        await userRow[0].decrement({reactions: 1}, {
            where: {reactions: {[Op.gt]: 0}}
        });
    }

    // Update role
    const newScore = Math.max(userRow[0].get("reactions") + (increment ? 1 : -1), 0);
    await updateRole(message, newScore);
};

async function updateRole(message, newScore) {
    // Get guild map
    let lastUpdateGuild = lastUpdate.get(message.guild.id);
    if (!lastUpdateGuild) {
        lastUpdateGuild = new Collection();
        lastUpdate.set(message.guild.id, lastUpdateGuild);
    }

    // Time variables
    const timeout = 1.5 * 1000;
    const now = Date.now();

    // Set user into map
    lastUpdateGuild.set(message.author.id, now);

    // Schedule role update
    setTimeout(async () => {
        // Check if timeout was overwritten
        if (lastUpdateGuild.get(message.author.id) !== now) {
            return;
        }

        // Delete entry
        lastUpdateGuild.delete(message.author.id);

        // Get roles sorted ascending
        const guildBoundaries = await roles.findAll({
            where: {guild: message.guild.id},
            attributes: ["reactions", "role"],
            order: [["reactions"]]
        });

        // Check if something has to be modified
        if (!guildBoundaries) {
            return;
        }

        // Get new role of user
        let userRole;
        if (guildBoundaries.length >= 1 && guildBoundaries[0].get("reactions") <= newScore) {
            userRole = guildBoundaries[0];

            for (let role of guildBoundaries) {
                if (role.get("reactions") <= newScore) {
                    userRole = role;
                } else {
                    break;
                }
            }

            // Update role
            await message.member.roles.add(userRole.get("role"));
        } else {
            userRole = null;
        }

        // Remove roles user should not have
        for (let role of guildBoundaries) {
            const currentRole = role.get("role");

            // Check if member has a role they should not have
            if ((!userRole || currentRole !== userRole.get("role")) && message.member.roles.cache.has(currentRole)) {
                // Remove role
                await message.member.roles.remove(currentRole);
            }
        }
    }, timeout);
}
