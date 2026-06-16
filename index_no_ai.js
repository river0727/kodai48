App.AI = {
    apiEndpoint: null,
    async reply(npcId, ctx, msg) {
        console.log('📝 使用本地回复:', { npcId, ctx, msg });
        return this.localReply(npcId, ctx, msg);
    },
    localReply(npcId, ctx, msg) {
        const q = evaluateReply(msg);
        let pool;
        if (ctx.npcType === 'agent') pool = App.ReplyLib.agent[ctx.personality] || App.ReplyLib.agent['严厉专业'];
        else if (ctx.npcType === 'sweet') pool = App.ReplyLib.sweet;
        else if (ctx.npcType === 'sister') pool = App.ReplyLib.sister;
        else if (ctx.npcType === 'rival') pool = App.ReplyLib.rival;
        else if (ctx.npcType === 'teammate') pool = App.ReplyLib.teammate;
        else if (ctx.npcType === 'member') pool = App.ReplyLib.member;
        else pool = App.ReplyLib.fan_positive;
        let r = pick(pool);
        const grp = App.NPCData[G.player.group];
        if (grp) {
            const coreMember = grp.core.find(c => c.name === npcId);
            if (coreMember && coreMember.habits && Math.random() < 0.4) {
                const habit = pick(coreMember.habits);
                if (habit.includes('口头禅')) r = habit.replace('口头禅：','') + ' ' + r;
            }
        }
        if (q === 'heartfelt') r += ' ' + pick(['好感动❤️','被你暖到了💕']);
        else if (q === 'perfunctory') r = pick(['...嗯，','好吧，']) + r;
        return r;
    },
    async image(prompt) {
        const seed = prompt.split('').reduce((a,c)=>a+c.charCodeAt(0),0);
        return `https://picsum.photos/seed/${seed}/400/300`;
    }
};
