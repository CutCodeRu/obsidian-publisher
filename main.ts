import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	FileSystemAdapter,
	requestUrl,
} from 'obsidian';
import fs from "fs";

interface PublisherSettings {
	token: string;
	host: string;
}

const DEFAULT_SETTINGS: PublisherSettings = {
	token: '',
	host: '',
}

export default class PublisherPlugin extends Plugin {
	settings: PublisherSettings;
	basePath: string;
	cachedChannels: Array<number>;

	async onload() {
		await this.loadSettings();

		this.cachedChannels = []

		const adapter = this.app.vault.adapter as FileSystemAdapter;
		this.basePath = adapter.getBasePath();

		this.addRibbonIcon('send', 'Publisher', (evt: MouseEvent) => {
			new PublishModal(this.app, this).open();
		});

		this.addSettingTab(new PublisherSettingTab(this.app, this));
	}

	onunload() {
		//
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class PublishModal extends Modal {
	plugin: PublisherPlugin
	title: string
	date: string
	onlyCreate: boolean
	editor: Editor|undefined
	view: MarkdownView|null
	files: Array<string>
	channels: Array<number>

	constructor(app: App, plugin: PublisherPlugin) {
        super(app);

		this.plugin = plugin
		this.editor = this.app.workspace.activeEditor?.editor
		this.view = this.app.workspace.getActiveViewOfType(MarkdownView);
		this.title = this.view?.file?.name?.replace('.md', '') ?? ""
		this.date = ""
		this.onlyCreate = false
		this.files = []
		this.channels = []
	}

	async onOpen() {
		if(typeof this.editor === "undefined") {
			new Notice('Open or Create the file you want to publish')
			this.close()
		}

		const text = this.editor?.getValue() ?? ''
		const pattern = /!\[\[.*?]]/g;

		const matches = text.match(pattern);

		const vault = this.app.vault
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const t = this

		matches?.forEach(function (v) {
			const fileName = v
				.replace('![[', '')
				.replace(']]', '')

			const file = vault.getFileByPath(fileName)

			if(file) {
				t.files.push(t.plugin.basePath + "/" + file.path)
			}
		})

		const {contentEl} = this;

		contentEl.createEl("h1", { text: "Publish" });

		new Setting(contentEl)
			.setName("Title")
			.addText((text) =>
				text.setValue(this.title).onChange((value) => {
					this.title = value
				}));

		new Setting(contentEl)
			.setName('Channels')
			.setHeading()

		if(t.plugin.cachedChannels.length === 0) {
			const response = await requestUrl({
				url: this.plugin.settings.host + '/api/channels',
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${this.plugin.settings.token}`
				}
			})

			const data = response.json

			t.plugin.cachedChannels = data.channels
		}

		let index = 0

		Object.entries(t.plugin.cachedChannels).forEach(([id, name]) => {
			if(index === 0) {
				// @ts-ignore
				this.channels[id] = id
			}

			new Setting(contentEl)
				// @ts-ignore
				.setName(name)
				.addToggle((toggle) => toggle.setValue(index === 0).onChange((value) => {
					// @ts-ignore
					delete this.channels[id];

					if(value) {
						// @ts-ignore
						this.channels[id] = id
					}
				}))

			index++
		})


		new Setting(contentEl)
			.setName("Delayed publication")
			.addText((text) =>
				text
					.setPlaceholder("d.m.Y H:i")
					.onChange(async (value) => {
						this.date = value
					})
			);

		new Setting(contentEl)
			.setName('Only create')
			.addToggle((toggle) => toggle.onChange((value) => {
				this.onlyCreate = value
			}))

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Publish")
					.setCta()
					.onClick(() => {
						this.publish(this.editor?.getValue() ?? '')
					}));
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}

	async publish(text: string) {
		if(this.title === "") {
			new Notice('Title is required')

			return;
		}

		if (this.channels.length === 0) {
			new Notice('Channels is required')

			return;
		}

		const host = this.plugin.settings.host
		//const host = 'http://127.0.0.1:8000'
		const form = new FormData()

		try {
			const files= {}
			const channels= {}

			this.files.forEach(function (file, index) {
				// @ts-ignore
				files[file] = fs.readFileSync(file)
			})


			this.channels.forEach(function (channel, id) {
				// @ts-ignore
				channels[id] = channel
			})

			new Notice('Loading...')

			await requestUrl({
				url: host + '/api/publish',
				body: JSON.stringify({
					title: this.title,
					text: text,
					channels: channels,
					when_to_post: this.date,
					only_create: this.onlyCreate,
					files: files,
				}),
				method: "POST",
				contentType: "application/json",
				headers: {
					'Authorization': `Bearer ${this.plugin.settings.token}`,
					//'X-Buggregator-Event': 'http-dump',
				},
			})
				.then((response) => new Notice('Published'))
				.catch((err) => new Notice(err.message))
		} catch (e) {
			new Notice(e)
		}

		this.close()
	}
}

class PublisherSettingTab extends PluginSettingTab {
	plugin: PublisherPlugin;

	constructor(app: App, plugin: PublisherPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Token')
			.setDesc('Publisher API')
			.addText(text => text
				.setPlaceholder('Enter your token')
				.setValue(this.plugin.settings.token)
				.onChange(async (value) => {
					this.plugin.settings.token = value;
					await this.plugin.saveSettings();
				}));


		new Setting(containerEl)
			.setName('Host')
			.addText(text => text
				.setValue(this.plugin.settings.host)
				.onChange(async (value) => {
					this.plugin.settings.host = value;
					await this.plugin.saveSettings();
				}));
	}
}
