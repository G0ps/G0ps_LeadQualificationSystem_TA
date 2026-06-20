import pkg from '@slack/bolt';
const { App } = pkg;
import { WebClient } from '@slack/web-api';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'; // Added Gemini import
import { ChatPromptTemplate } from '@langchain/core/prompts';

import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';

import { initDatabase, savememberAnalysis, markAsSentToSlack, closeDatabase } from './db.js';

dotenv.config();

const log = {
    info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
    error: (msg, ...args) => console.log(`[ERROR] ${msg}`, ...args),
    debug: (msg, ...args) => process.env.NODE_ENV === "development" && console.log(`[DEBUG] ${msg}`, ...args)
};

class SlackAIAgent {
    constructor() {
        this.app = express();

        this.slack = new App({
            token: process.env.SLACK_BOT_TOKEN,
            signingSecret: process.env.SLACK_SIGNING_SECRET,
            socketMode: true,
            appToken: process.env.SLACK_APP_TOKEN
        });

        this.WebClient = new WebClient(process.env.SLACK_BOT_TOKEN);
        
        // Primary LLM
        this.openai = new ChatOpenAI({
            model: "gpt-4o", // Changed from placeholder gpt-5.4 to actual model name
            temperature: 0.3,
            apiKey: process.env.OPENAI_API_KEY
        });

        // Fallback LLM (Gemini)
        this.gemini = new ChatGoogleGenerativeAI({
            model: "gemini-2.5-flash",
            temperature: 0.3,
            apiKey: process.env.GOOGLE_API_KEY
        });

        this.setupSlackEvents();
        this.setupExpress();
    }

    setupSlackEvents() {
        this.slack.event('team_join', async ({ event }) => {
            try {
                log.info(`New member joined: ${event.user.real_name || event.user.name}`);
                const userInfo = await this.getUserInfo(event.user.id);
                await this.analyzeAndPostMember(userInfo);
            } catch (error) {
                log.error('Error processing team_join: ', error.message);
            }
        });

        this.slack.event('member_joined_channel', async ({ event }) => {
            try {
                if (event.channel_type === 'C') {
                    log.info(`Member ${event.user} joined channel ${event.channel}`);
                    const userInfo = await this.getUserInfo(event.user);
                    await this.analyzeAndPostMember(userInfo);
                }
            } catch (error) {
                log.error('Error processing member_joined_channel: ', error.message);
            }
        });

        this.slack.error(async (error) => log.error('Slack error: ', error.message));
    }

    setupExpress() {
        this.app.use(express.json());

        this.app.get('/health', (req, res) => {
            return res.json({ status: "healthy", timestamp: new Date().toISOString() });
        });

        if (process.env.NODE_ENV === "development") {
            this.app.post('/test/analyze-member', async (req, res) => {
                try {
                    const { memberInfo } = req.body;
                    if (!memberInfo) return res.status(400).json({ error: 'memberInfo is missing' });
                    const analysis = await this.analyzeAndPostMember(memberInfo);
                    return res.json({ success: true, analysis, timestamp: new Date().toISOString() });
                } catch (error) {
                    log.error('Test analysis error: ', error.message);
                    res.status(500).json({ error: 'Analysis failed', message: error.message });
                }
            });
        }

        this.app.use((err, req, res, next) => {
            log.error(`Express error: `, err.message);
            return res.status(500).json({ error: 'Internal server error' });
        });
    }

    async getUserInfo(userId) {
        const result = await this.WebClient.users.info({ user: userId });
        const user = result.user;

        return {
            id: user.id,
            name: user.real_name || user.name,
            username: user.name,
            email: user.profile?.email,
            title: user.profile?.title,
            timezone: user.tz,
            profile: {
                firstName: user.profile?.first_name,
                lastName: user.profile?.last_name,
                statusText: user.profile?.status_text
            }
        };
    }

    async analyzeAndPostMember(memberInfo) {
        let analysisId = null;

        try {
            log.info(`Processing member: ${memberInfo.name}`);
            const researchData = await this.doBasicResearch(memberInfo);
            const analysis = await this.analyzeWithAI(memberInfo, researchData);
            
            log.info(`Saving analysis to DB for ${memberInfo.name}`);
            analysisId = await savememberAnalysis(memberInfo, analysis, researchData);

            await this.postAnalysisToChannel(memberInfo, analysis, researchData);

            if (analysisId) {
                await markAsSentToSlack(analysisId);
            }
            return analysis;
        } catch (error) {
            log.error(`Error processing ${memberInfo.name}: `, error.message);
            if (analysisId) {
                log.info(`Analysis ${analysisId} saved to DB but not sent to slack`);
            }
            throw error;
        }
    }

    async doBasicResearch(memberInfo) {
        const results = [];

        try {
            if (memberInfo.email && !this.isPersonalEmail(memberInfo.email)) {
                const domain = memberInfo.email.split('@')[1];
                const companyInfo = await this.getCompanyInfo(domain);

                if (companyInfo) {
                    results.push(companyInfo);
                }
            }

            if (memberInfo.name) {
                const githubInfo = await this.getGitHubInfo(memberInfo.name);
                if (githubInfo) results.push(githubInfo);
            }
            
            return results;
        } catch (error) {
            log.error(`Research error: `, error.message);
            return results;
        }
    }

    async getCompanyInfo(domain) {
        try {
            const response = await axios.get(`https://www.${domain}`, {
                timeout: 5000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });

            const titleMatch = response.data.match(/<title>(.*?)<\/title>/i);
            const title = titleMatch ? titleMatch[1] : `Company: ${domain}`;

            return {
                url: `https://www.${domain}`,
                title: title.trim(),
                content: `Company website for ${domain}`,
                type: 'company'
            };
        } catch (error) {
            log.error(`Could not fetch ${domain}: `, error.message);
            return null;
        }
    }

    async getGitHubInfo(name) {
        try {
            const response = await axios.get(
                `https://api.github.com/search/users?q=${encodeURIComponent(name)}`,
                { timeout: 5000 }
            );

            if (response.data.items && response.data.items.length > 0) {
                const user = response.data.items[0];
                return {
                    url: user.html_url,
                    title: `GitHub: ${user.login}`,
                    content: `GitHub profile found for user sequence`,
                    type: 'github'
                };
            }
        } catch (error) {
            log.debug('GitHub search error: ', error.message);
        }
        return null;
    }

    async analyzeWithAI(memberInfo, researchData) {
        const prompt = ChatPromptTemplate.fromTemplate(
            `
            Analyze this new community member for fit with our commercial product.
            NOTE : No markdowns in the response such as bold texts and any other textual adjustments.

            company : {company}
            Product : {product}

            MEMBER : 
            - Name {name}
            - Email {email}
            - Title {title}

            Research DATA : 
            {research}

            Provide a JSON response with : 
            - fitScore (0-100) likelihood they'd be intrested in our product
            - insights : array of 3-5 key observations
            - recommendations : array of 2-4 engagement suggestions

            Consider job title , company size , technical background , and budget authority.
            `
        );

        const researchSummary = researchData.length > 0 
            ? researchData.map(r => `${r.title}: ${r.content}`).join('\n') 
            : "Limited research data available";

        const inputPayload = {
            company: process.env.COMPANY_NAME || 'YOUR COMPANY',
            product: process.env.COMPANY_PRODUCT || 'YOUR PRODUCT',
            name: memberInfo.name,
            email: memberInfo.email || "not provided",
            title: memberInfo.title || "Not provided",
            research: researchSummary
        };

        let result;

        try {
            // Attempt with OpenAI primary
            log.info("Attempting analysis with OpenAI...");
            const chain = prompt.pipe(this.openai);
            result = await chain.invoke(inputPayload);
        } catch (openAiError) {
            log.error(`OpenAI error: ${openAiError.message}. Triggering Google Gemini fallback...`);
            try {
                // Fallback to Gemini
                const fallbackChain = prompt.pipe(this.gemini);
                result = await fallbackChain.invoke(inputPayload);
            } catch (geminiError) {
                log.error(`Gemini fallback also failed: `, geminiError.message);
                // Return a graceful backup object if all LLMs fail
                return {
                    fitScore: 50,
                    insights: ["Unable to complete automated analysis due to AI network error."],
                    recommendations: ["Manual review recommended"]
                };
            }
        }

        try {
            const responseText = result.content || result;
            const cleanedResponse = responseText.replace(/```json\n?|```/g, '').trim();
            const analysis = JSON.parse(cleanedResponse);

            return {
                fitScore: Math.max(0, Math.min(100, analysis.fitScore || 50)),
                insights: Array.isArray(analysis.insights) ? analysis.insights : ["Analysis completed"],
                recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : ["Follow up recommended"]
            };
        } catch (parseError) {
            log.error(`JSON Parse error on AI response: `, parseError.message);
            return {
                fitScore: 50,
                insights: ["Failed to format AI payload output correctly."],
                recommendations: ["Manual review recommended"]
            };
        }
    }

    async postAnalysisToChannel(member, analysis, researchData) {
        const blocks = [
            {
                type: 'header',
                text: { type: 'plain_text', text: `New Member: ${member.name}` },
            },
            {
                type: 'section',
                fields: [
                    { type: 'mrkdwn', text: `*Fit Score:* ${analysis.fitScore}/100` },
                    { type: 'mrkdwn', text: `*Email:* ${member.email || 'Not provided'}` },
                    { type: 'mrkdwn', text: `*Title:* ${member.title || 'Not provided'}` },
                ]
            }
        ];

        if (analysis.insights.length > 0) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Insights:*\n${analysis.insights.map(i => `• ${i}`).join('\n')}`
                }
            });
        }

        if (analysis.recommendations.length > 0) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Recommendations:*\n${analysis.recommendations.map(i => `• ${i}`).join('\n')}`
                }
            });
        }

        blocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `Analyzed: ${new Date().toISOString()}`
                }
            ]
        });

        await this.WebClient.chat.postMessage({
            channel: process.env.SLACK_PRIVATE_CHANNEL_ID,
            text: `New Member analysis: ${member.name} (${analysis.fitScore}/100)`,
            blocks
        });

        log.info(`Analysis posted to Channel for ${member.name}`);
    }

    isPersonalEmail(email) {
        const personalDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];
        const domain = email.split('@')[1]?.toLowerCase();
        return personalDomains.includes(domain);
    }

    async start() {
        try {
            log.info("INITIALIZING Database");
            await initDatabase();

            const port = process.env.PORT || 3000;
            this.server = this.app.listen(port, () => {
                log.info(`Express server running on port ${port}`);
            });

            await this.slack.start();
            log.info('Slack BOT Connected and running');

            if (process.env.NODE_ENV === "development") {
                log.info("test endpoint: POST http://localhost:" + port + "/test/analyze-member");
            }
        } catch (error) {
            log.error(`Failed to start: `, error.message);
            process.exit(1);
        }
    }

    async stop() {
        log.info('Shutting down...');
        try {
            await this.slack.stop();
            if (this.server) {
                await new Promise(resolve => {
                    this.server.close(resolve);
                });
            }
            await closeDatabase();
            log.info("Stopped Successfully");
        } catch (error) {
            log.error("Shutting down error: ", error.message);
        }
        process.exit(0);
    }
}

const agent = new SlackAIAgent();

process.on('SIGINT', () => agent.stop());
process.on('SIGTERM', () => agent.stop());

agent.start().catch(error => {
    console.error("Startup failed: ", error.message);
    process.exit(1);
});

export default agent;