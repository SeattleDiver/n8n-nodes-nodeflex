import type {
	ICredentialType,
	INodeProperties,
	ICredentialTestRequest,
	IHttpRequestMethods,
} from 'n8n-workflow';

export class PrivateWorkflowPrivateKeyApi implements ICredentialType {
	name = 'privateWorkflowPrivateKeyApi';
	displayName = 'Private Workflow Credentials with Private Key API';
	documentationUrl = 'https://github.com/SeattleDiver/n8ncloud-workflow';
	description = `Authentication credentials for the Private Workflow with Private Key.

	**Documentation:** [View Setup Guide](https://github.com/SeattleDiver/n8ncloud-workflow)`;

	// 👇 The standard n8n properties definition
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
	    // eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
			typeOptions: { password: false },
			default: '',
			required: true,
			description: 'API key for authenticating with the n8nCloud Private Workflow API.',
		},
		{
			displayName: 'Private Key for Payload encryption/decription',
			name: 'privateKey',
			type: 'string',
	    // eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
			typeOptions: { rows: 5 },
			default: '',
			required: false,
			description: 'Private key used to decrypt/encrypt requests and responses.',
		},
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
