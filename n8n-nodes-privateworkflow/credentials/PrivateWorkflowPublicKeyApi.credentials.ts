import type {
	ICredentialType,
	INodeProperties,
	ICredentialTestRequest,
	IHttpRequestMethods,
} from 'n8n-workflow';

export class PrivateWorkflowPublicKeyApi implements ICredentialType {
	name = 'privateWorkflowPublicKeyApi';
	displayName = 'Private Workflow Credentials with Public Key API';
	icon = 'fa:key' as const;
	documentationUrl = 'https://github.com/SeattleDiver/nodeflex-workflow';
	description = `Authentication credentials for the Private Workflow with Public Key.

	**Documentation:** [View Setup Guide](https://github.com/SeattleDiver/nodeflex-workflow)`;

	// 👇 The standard n8n properties definition
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'API key for authenticating with the NodeFlex Private Workflow API.',
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
			url: '=https://hub.nodeflex.io/api/apikeys/verify',
			qs: {
				apiKey: '={{$credentials.apiKey}}',
			},
		},
	};
}
