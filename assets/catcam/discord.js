(() => {
    'use strict';
    const form = document.querySelector('#discord-settings');
    if (!form) return;
    const feedback = document.querySelector('#discord-feedback');
    const save = document.querySelector('#save-discord'), test = document.querySelector('#test-discord');
    const csrfToken = document.querySelector('#camera-settings').elements.csrfToken.value;
    async function request(url, body) {
        const response = await fetch(url, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({...body, csrfToken})});
        const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ?
            'Admin access expired. Sign in again and reload this page.' : result.error || 'Discord settings could not be updated.');
        return result;
    }
    form.addEventListener('submit', async event => {
        event.preventDefault();
        save.disabled = true;
        const testWasDisabled = test.disabled;
        test.disabled = true;
        feedback.classList.remove('error');
        feedback.textContent = 'Saving…';
        let result;
        try {
            const fields = form.elements;
            result = await request('/catcam/discord/settings', {discordEnabled: !fields.discordRemove.checked && fields.discordEnabled.checked,
                discordCooldownSeconds: fields.discordCooldownSeconds.value, discordWebhookUrl: fields.discordWebhookUrl.value,
                discordRemove: fields.discordRemove.checked});
            fields.discordWebhookUrl.value = '';
            fields.discordWebhookUrl.placeholder = result.configured ? 'Webhook saved — leave blank to keep it' : 'https://discord.com/api/webhooks/…';
            fields.discordRemove.checked = false;
            fields.discordEnabled.checked = result.enabled;
            document.querySelector('#discord-configured').textContent = result.configured ? 'A webhook is saved securely. Its URL is never displayed.' : 'No webhook saved.';
            feedback.textContent = result.enabled ? `Discord alerts enabled. At most one message every ${result.cooldownSeconds} seconds.` :
                result.configured ? 'Discord alerts disabled. Your webhook is still saved.' : 'Discord alerts disabled.';
        } catch (error) {feedback.classList.add('error'); feedback.textContent = error.message;}
        finally {save.disabled = false; test.disabled = result ? !result.configured : testWasDisabled;}
    });
    test.addEventListener('click', async () => {
        test.disabled = true;
        save.disabled = true;
        feedback.classList.remove('error');
        feedback.textContent = 'Sending test…';
        try {await request('/catcam/discord/test', {}); feedback.textContent = 'Test message sent. The message cooldown also applies to tests.';}
        catch (error) {feedback.classList.add('error'); feedback.textContent = error.message;}
        finally {test.disabled = false; save.disabled = false;}
    });
    // A newly configured camera can save its Discord settings without reloading.
    document.querySelector('#camera-settings').addEventListener('camera-configured', () => {save.disabled = false;});
})();
