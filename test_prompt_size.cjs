const fs = require('fs');
const content = fs.readFileSync('src/config/prompts.ts', 'utf8');

const basePromptStart = content.indexOf('export const BASE_SYSTEM_PROMPT = `<lucen_system>');
const basePromptEnd = content.indexOf('</lucen_system>`;');

const prompt = content.substring(basePromptStart + 'export const BASE_SYSTEM_PROMPT = `'.length, basePromptEnd + '</lucen_system>'.length);

console.log('Total characters:', prompt.length);

const allSections = ['identity', 'core_thinking', 'voice', 'versatility', 'honesty', 'format', 'artifacts', 'design_intelligence', 'tools', 'lucen_system'];
let sectionLengths = {};

allSections.forEach(sec => {
    const regex = new RegExp('<'+sec+'>([\\s\\S]*?)</'+sec+'>');
    const match = prompt.match(regex);
    if(match) {
        sectionLengths[sec] = match[1].length;
    } else {
        sectionLengths[sec] = 0;
    }
});

console.log(sectionLengths);
