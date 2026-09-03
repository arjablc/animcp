declare global {
	namespace App {
		interface Platform {
			env: { APP_VERSION?: string };
		}
	}
}

export {};
