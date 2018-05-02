import { commands, ConfigurationChangeEvent, ConfigurationTarget, Disposable, Range, Uri, window, workspace } from 'vscode';
import { CSPost } from './api/api';
import { CodeStreamSession, PostsReceivedEvent } from './api/session';
import { BotResponse, BotTrigger, configuration } from './configuration';
import { Container } from './container';
import { encryptionKey } from './extension';
import { Logger } from './logger';
import { Command, createCommandDecorator, Crypto, Functions } from './system';
import * as path from 'path';

const commandRegistry: Command[] = [];
const command = createCommandDecorator(commandRegistry);

const responseCodeBlockRegex = /(\d+),(\d+):(.+)/;

export class CodeStreamBot extends Disposable {

    private readonly _disposable: Disposable;
    private _disposableSignedIn: Disposable | undefined;
    private _session: CodeStreamSession | undefined;
    private _triggers: (BotTrigger & { regex: RegExp })[] = [];

    constructor() {
        super(() => this.dispose());

        this._disposable = Disposable.from(
            ...commandRegistry.map(({ name, key, method }) => commands.registerCommand(name, (...args: any[]) => method.apply(this, args))),
            configuration.onDidChange(this.onConfigurationChanged, this)
        );

        this.onConfigurationChanged(configuration.initializingChangeEvent);
    }

    dispose() {
        this.signOut();
        this._disposable && this._disposable.dispose();
    }

    private async onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        if (!initializing && !configuration.changed(e, configuration.name('bot').value)) return;

        if (initializing || configuration.changed(e, configuration.name('bot')('triggers').value)) {
            this._triggers = Container.config.bot.triggers.map(t => ({ ...t, regex: new RegExp(t.message, 'i') }));
        }

        if (initializing ||
            configuration.changed(e, configuration.name('bot')('enabled').value) ||
            configuration.changed(e, configuration.name('bot')('email').value) ||
            configuration.changed(e, configuration.name('bot')('password').value)) {
            this.signOut();
            if (Container.config.bot.enabled) {
                this.signIn(Container.config.bot.email, Container.config.bot.password);
            }
        }
    }

    async signIn(email: string | undefined, password: string | undefined) {
        if (this._session !== undefined) return;

        if (password) {
            try {
                password = Crypto.decrypt(password, 'aes-256-ctr', encryptionKey);
            } catch {
                password = undefined;
            }
        }

        if (!email || !password) {
            if (!email) {
                password = undefined;

                email = await window.showInputBox({
                    prompt: 'Enter the demobot\'s CodeStream email address',
                    placeHolder: 'e.g. @company.com'
                });
                if (email === undefined) return;

                await configuration.update(configuration.name('bot')('email').value, email, ConfigurationTarget.Workspace, null);
            }

            if (!password) {
                password = await window.showInputBox({
                    prompt: 'Enter the demobot\'s CodeStream password',
                    placeHolder: 'password',
                    password: true
                });
                if (password === undefined) return;

                await configuration.update(configuration.name('bot')('password').value, Crypto.encrypt(password, 'aes-256-ctr', encryptionKey), ConfigurationTarget.Workspace, null);
            }
        }

        try {
            this._session = new CodeStreamSession(Container.config.serverUrl);

            this._disposableSignedIn = Disposable.from(
                this._session,
                this._session.onDidReceivePosts(this.onPostsReceived, this)
            );

            await this._session.login(email, password, Container.config.teamId);
        }
        catch (ex) {
            Logger.error(ex);
            debugger;
        }
    }

    signOut() {
        if (this._session === undefined) return;

        this._disposableSignedIn && this._disposableSignedIn.dispose();
        this._session === undefined;
    }

    private _pending: { response: BotResponse, post: CSPost } | undefined;

    @command('bot.trigger')
    trigger() {
        if (this._pending === undefined) return;

        return this.postResponse(this._pending.response, this._pending.post);
    }

    private async onPostsReceived(e: PostsReceivedEvent) {
        for (const p of e.entities()) {
            for (const trigger of this._triggers) {
                if (!trigger.regex.test(p.text)) continue;

                switch (trigger.type) {
                    case 'immediate':
                        this.postResponse(trigger.response, p);
                        break;

                    case 'delayed':
                        await Functions.wait((Math.floor(Math.random() * (5 - 1)) + 1) * 1000);
                        this.postResponse(trigger.response, p);
                        break;

                    case 'hotkey':
                        this._pending = { response: trigger.response, post: p };
                        break;
                }
            }
        }
    }

    private async postResponse(response: BotResponse, post: CSPost) {
        if (response.codeBlock !== undefined) {
            const match = responseCodeBlockRegex.exec(response.codeBlock);
            if (match != null) {
                const [, start, end, filename] = match;

                let doc;
                try {
                    doc = await workspace.openTextDocument(Uri.file(path.join(workspace.workspaceFolders![0].uri.fsPath, filename)));
                }
                catch { }

                if (doc !== undefined) {
                    const range = new Range(parseInt(start, 10), 0, parseInt(end, 10), Number.MAX_VALUE);

                    return Container.commands.postCode({
                        streamThread: {
                            id: response.location === 'thread' ? post.id : undefined,
                            streamId: post.streamId
                        },
                        text: response.message,
                        send: true,
                        document: doc,
                        range: range,
                        session: this._session
                    });
                }
            }
        }

        return Container.commands.post({
            streamThread: {
                id: response.location === 'thread' ? post.id : undefined,
                streamId: post.streamId
            },
            text: response.message,
            send: true,
            silent: true,
            session: this._session
        });
    }
}
