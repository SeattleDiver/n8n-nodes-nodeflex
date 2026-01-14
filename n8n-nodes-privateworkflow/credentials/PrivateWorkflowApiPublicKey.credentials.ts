import type {
	ICredentialType,
	INodeProperties,
	ICredentialTestRequest,
	IHttpRequestMethods,
} from 'n8n-workflow';

export class PrivateWorkflowApiPublicKey implements ICredentialType {
	name = 'privateWorkflowApiPublicKey';
	displayName = 'Private Workflow Credentials with Public Key';
	documentationUrl = 'https://github.com/SeattleDiver/n8ncloud-workflow';
	description = `Authentication credentials for the Private Workflow with Public Key.

	**Documentation:** [View Setup Guide](https://github.com/SeattleDiver/n8ncloud-workflow)`;

	// 👇 The standard n8n properties definition
	properties: INodeProperties[] = [
		// {
		// 	displayName: 'Environment',
		// 	name: 'baseUrl',
		// 	type: 'options',
		// 	default: 'http://localhost:5268',
		// 	description: 'Select the environment for the Private Workflow API.',
		// 	options: [
		// 		{
		// 			name: 'Development',
		// 			value: 'http://localhost:5268',
		// 		},
		// 		{
		// 			name: 'Production',
		// 			value: 'https://hub.n8ncloud.io',
		// 		},
		// 	],
		// },
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: false },
			default: '',
			required: true,
			description: 'API key for authenticating with the n8nCloud Private Workflow API.',
		},
		{
			displayName: 'Public Key for Payload encryption/decription',
			name: 'publicKey',
			type: 'string',
			typeOptions: { rows: 5, password: false },
			default: '',
			required: false,
			description: 'Public key used to encrypt/decrypt messages with Private Workflow instances.',
		}
	];

	// Define the built-in test connection configuration
	test: ICredentialTestRequest = {
		request: {
			method: 'GET' as IHttpRequestMethods,
			url: '=https://hub.n8ncloud.io/api/apikeys/verify',
			qs: {
				apiKey: '={{$credentials.apiKey}}',
			},
		},
	};
}
