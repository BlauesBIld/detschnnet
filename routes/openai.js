const express = require('express');
const router = express.Router();
const winston = require('winston');
const {OpenAI} = require('openai');

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

const openai = new OpenAI();

router.post('/createChat', async (req, res) => {
    try {
        const name = req.body.name;
        const description = req.body.description;

        const run = await openai.beta.threads.createAndRun({
            assistant_id: ASSISTANT_ID,
            thread: {
                messages: [
                    {role: "user", content: description},
                ]
            }
        });

        if (!run || !run.id) {
            return res.status(500).send({error: "Failed to create chat thread."});
        }

        const completedRun = await checkRunStatusUntilDone(run.thread_id, run.id);

        const body = {
            name: name,
            description: description,
            threadId: completedRun.thread_id,
        };

        res.status(201).send(body);
    } catch (error) {
        console.error("Error creating chat:", error);
        res.status(500).send({error: "Internal server error."});
    }
});

router.delete('/deleteChat', async (req, res) => {
    try {
        const thread_id = req.body.threadId;

        const thread = await openai.beta.threads.del(thread_id);

        if (!thread || !thread.id) {
            return res.status(500).send({error: "Failed to delete chat thread."});
        }

        res.status(204).send();
    } catch (error) {
        console.error("Error deleting chat:", error);
        res.status(500).send({error: "Internal server error."});
    }
});

router.post('/getNextMessage', async (req, res) => {
    try {
        const thread_id = req.body.threadId;

        const lastMessage = await getLastMessageInThread(thread_id);

        if (lastMessage.role === "user") {
            const run = await openai.beta.threads.runs.create(
                thread_id,
                {assistant_id: ASSISTANT_ID}
            );

            const completedRun = await checkRunStatusUntilDone(run.thread_id, run.id);

            const nextMessage = await getLastMessageInThread(completedRun.thread_id);
            res.status(200).send(nextMessage);
        } else {
            res.status(200).send(lastMessage);
        }


    } catch (error) {
        console.error("Error getting next message:", error);
        res.status(500).send({error: "Internal server error."});
    }
});

router.get('/getMessages', async (req, res) => {
    try {
        const thread_id = req.body.threadId;

        const threadMessages = await openai.beta.threads.messages.list(
            thread_id
        );

        res.status(200).send(threadMessages);
    } catch (error) {
        console.error("Error getting next message:", error);
        res.status(500).send({error: "Internal server error."});
    }
});

router.get('/getRuns', async (req, res) => {
    try {
        const thread_id = req.body.threadId;

        const threadRuns = await openai.beta.threads.runs.list(
            thread_id
        );

        res.status(200).send(threadRuns);
    } catch (error) {
        console.error("Error getting next message:", error);
        res.status(500).send({error: "Internal server error."});
    }
});

router.get('/getRunInfo'), async (req, res) => {
    try {
        const thread_id = req.body.threadId;
        const run_id = req.body.runId;
        const run = await openai.beta.threads.runs.retrieve(
            thread_id,
            run_id
        );
        res.status(200).send(run);
    } catch (error) {
        console.error("Error getting run info:", error);
        res.status(500).send({error: "Internal server error."});
    }
}

router.post('/sendMessageAndGetResponse', async (req, res) => {
    try {
        const thread_id = req.body.threadId;
        const message = req.body.message;

        const lastMessage = await getLastMessageInThread(thread_id);

        if (!(lastMessage.role === "user")) {
            const threadMessages = await openai.beta.threads.messages.create(
                thread_id,
                {role: "user", content: message}
            );

            const run = await openai.beta.threads.runs.create(
                thread_id,
                {assistant_id: ASSISTANT_ID}
            );

            const completedRun = await checkRunStatusUntilDone(run.thread_id, run.id);
            const nextMessage = await getLastMessageInThread(completedRun.thread_id);

            res.status(200).send(nextMessage);
        } else {
            res.status(400).send(lastMessage);
        }

    } catch (error) {
        console.error("Error sending message:", error);
        res.status(500).send({error: "Internal server error."});
    }
});

router.get('/getThreadInfo', async (req, res) => {
    try {
        const thread_id = req.body.threadId;

        const thread = await openai.beta.threads.retrieve(thread_id);

        res.status(200).send(thread);
    } catch (error) {
        console.error("Error getting thread info:", error);
        res.status(500).send({error: "Internal server error."});
    }
});

async function checkRunStatusUntilDone(thread_id, run_id) {
    const run = await openai.beta.threads.runs.retrieve(thread_id, run_id);

    if (run.status === "queued" || run.status === "in_progress") {
        await new Promise(resolve => setTimeout(resolve, 500));
        return await checkRunStatusUntilDone(thread_id, run_id);
    } else {
        return run;
    }
}

async function getLastMessageInThread(thread_id) {
    const threadMessages = await openai.beta.threads.messages.list(
        thread_id
    );

    return threadMessages.data[0];
}

module.exports = router



