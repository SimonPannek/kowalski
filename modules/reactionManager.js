const {Discord, config, reactionCooldowns, ignoreReactions, roleBoundaries} = require("./globals");
const {users} = require("./database");

module.exports = async (reaction, user, increment = true) => {
    const message = reaction.message;
    const reactionsGuild = ignoreReactions.get(message.guild.id);

    if (!increment && reactionsGuild && reactionsGuild.has(message.id)) {
        // Reaction should get ignored

        // Delete entry from cache
        reactionsGuild.delete(message.id);
    } else if (reaction.emoji.name === config.reactions.emoji && !message.author.bot
        && user.id !== message.author.id && message.guild.members.cache.has(message.author.id)) {
        // Score increasing/decreasing reaction
        // TODO: Support multiple/per server emojis

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
                        // TODO: Try List instead of set to allow multiple entries
                        ignoreGuild = new Set();
                        ignoreReactions.set(message.guild.id, ignoreGuild);
                    }

                    ignoreGuild.add(message.id);

                    // Remove reaction
                    return reaction.users.remove(user);
                }
            }

            // Update cooldown
            if (!reactionGuild) {
                reactionGuild = new Discord.Collection();
                reactionCooldowns.set(message.guild.id, reactionGuild);
            }

            const currentCooldown = config.reactions.cooldown * 1000;
            reactionGuild.set(user.id, now + currentCooldown);

            // Remove cooldown from collection when expired
            setTimeout(() => reactionGuild.delete(user.id), currentCooldown);
        }

        try {
            // Get database entry
            let reacted = await users.findOne({where: {guild: message.guild.id, user: message.author.id}});

            if (!reacted) {
                // User does not exist, create new row
                reacted = await users.create({guild: message.guild.id, user: message.author.id});
            }

            // Get new score
            const currentScore = reacted.get("reactions");
            const newScore = await Math.max(currentScore + (increment ? 1 : -1), 0);

            // Update entry and roles if score has changed
            if (currentScore !== newScore) {
                await updateScore(message, newScore);
            }
        } catch (error) {
            console.error("Something went wrong when trying to update the database entry: ", error);
        }
    }
};

async function updateScore(message, newScore) {
    await users.update({reactions: newScore}, {where: {guild: message.guild.id, user: message.author.id}});

    // Get roles sorted ascending
    const guildBoundaries = roleBoundaries.get(message.guild.id);
    if (guildBoundaries) {
        const roles = guildBoundaries.sort((o1, o2) => o1.reactions - o2.reactions);
        // Determine role user should have
        let userRole;
        if (roles.length >= 1 && roles[0].reactions <= newScore) {
            userRole = roles[0];

            for (let role of roles) {
                if (role.reactions <= newScore) {
                    userRole = role;
                } else {
                    break;
                }
            }

            // Update role
            await message.member.roles.add(userRole.role);
        } else {
            userRole = null;
        }

        // Remove roles user should not have
        for (let role of roles) {
            // Check if member has a role they should not have
            if ((!userRole || role.role !== userRole.role) && message.member.roles.cache.has(role.role)) {
                // Remove role
                await message.member.roles.remove(role.role);
            }
        }
    }
}
