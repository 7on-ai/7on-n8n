# N8N Setup Automation

Automated N8N instance setup with user creation and workflow template import using Docker and GitHub Actions.

## 🚀 Features

- **Automated N8N Setup**: Creates user accounts automatically
- **Workflow Templates**: Imports pre-configured workflow templates
- **Docker-based**: Runs in containerized environment
- **GitHub Actions**: Auto-builds Docker images
- **Northflank Integration**: Designed for Northflank deployment
- **Webhook Notifications**: Sends setup completion notifications

## 📁 Repository Structure

```
n8n-setup/
├── .github/workflows/
│   └── docker-build.yml          # GitHub Actions workflow
├── scripts/
│   ├── setup.sh                  # Main setup script
│   ├── create-user.js            # N8N user creation
│   ├── import-workflows.js       # Workflow import logic
│   └── webhook-notify.js         # Success notifications
├── templates/
│   ├── default-workflows/        # Default workflow templates
│   │   ├── welcome-workflow.json
│   │   ├── basic-automation.json
│   │   └── webhook-example.json
│   └── custom-workflows/         # Custom workflow templates
│       └── placeholder.json
├── Dockerfile                    # Container configuration
├── package.json                  # Node.js dependencies
└── README.md                     # This file
```

## 🔧 Environment Variables

The setup process requires these environment variables:

### Required Variables
- `N8N_BASE_URL`: Base URL of the N8N instance
- `N8N_USER_EMAIL`: Email for the N8N user account
- `N8N_USER_PASSWORD`: Password for the N8N user account
- `N8N_USER_NAME`: Display name for the user
- `N8N_USER_ID`: Unique user identifier

### Optional Variables
- `WORKFLOW_TEMPLATES`: Comma-separated list of template categories (default: "default")
- `WEBHOOK_URL`: URL for setup completion notifications
- `GITHUB_TOKEN`: GitHub token for accessing private repositories
- `REPO_URL`: Repository URL for additional resources

## 🐳 Docker Usage

### Build Locally
```bash
docker build -t n8n-setup .
```

### Run Container
```bash
docker run --rm \
  -e N8N_BASE_URL=https://your-n8n.example.com \
  -e N8N_USER_EMAIL=user@example.com \
  -e N8N_USER_PASSWORD=secure_password \
  -e N8N_USER_NAME="John Doe" \
  -e N8N_USER_ID=user123 \
  -e WORKFLOW_TEMPLATES=default \
  -e WEBHOOK_URL=https://your-webhook.example.com/notify \
  n8n-setup
```

### Using GitHub Container Registry
```bash
docker run --rm \
  -e N8N_BASE_URL=https://your-n8n.example.com \
  -e N8N_USER_EMAIL=user@example.com \
  -e N8N_USER_PASSWORD=secure_password \
  -e N8N_USER_NAME="John Doe" \
  -e N8N_USER_ID=user123 \
  ghcr.io/your-username/n8n-setup:latest
```

## 📋 Workflow Templates

### Default Templates Included

1. **Welcome Workflow** (`welcome-workflow.json`)
   - Simple introduction workflow
   - Demonstrates basic N8N concepts
   - Manual trigger with informational nodes

2. **Basic Automation** (`basic-automation.json`)
   - Scheduled trigger example
   - Data processing and conditional logic
   - Runs weekdays at 9 AM

3. **Webhook Integration** (`webhook-example.json`)
   - HTTP webhook trigger
   - Request processing and response
   - API integration example

### Adding Custom Templates

1. Add your workflow JSON files to `templates/custom-workflows/`
2. Set `WORKFLOW_TEMPLATES=custom` or `WORKFLOW_TEMPLATES=default,custom`
3. Rebuild the Docker image or update the repository

### Template Format

Workflow templates should follow the standard N8N workflow format:

```json
{
  "name": "Your Workflow Name",
  "nodes": [
    // N8N node definitions
  ],
  "connections": {
    // Node connections
  },
  "active": false,
  "settings": {
    "executionOrder": "v1"
  }
}
```

## �� GitHub Actions

The repository includes automated Docker image building:

- **Triggers**: Push to main branch, pull requests
- **Registry**: GitHub Container Registry (ghcr.io)
- **Tags**: Latest, branch names, commit SHAs
- **Permissions**: Automatically configured

### Manual Trigger
```bash
# Trigger a manual build
git tag v1.0.0
git push origin v1.0.0
```

## 🌐 Northflank Integration

This setup is designed to work with Northflank templates:

```json
{
  "kind": "ManualJob",
  "spec": {
    "name": "n8n-setup",
    "deployment": {
      "external": { 
        "imagePath": "ghcr.io/your-username/n8n-setup:latest"
      }
    },
    "runtimeEnvironment": {
      "variables": {
        "N8N_BASE_URL": "https://your-instance.example.com",
        "WORKFLOW_TEMPLATES": "default"
      }
    }
  }
}
```

## 🐛 Troubleshooting

### Common Issues

1. **N8N Not Ready**
   ```
   ❌ Timeout waiting for N8N to be ready
   ```
   - Increase timeout in setup.sh
   - Check N8N service health
   - Verify network connectivity

2. **User Creation Failed**
   ```
   ❌ Error creating N8N user: Setup failed with status: 400
   ```
   - Check if user already exists
   - Verify N8N database is initialized
   - Check email format validity

3. **Workflow Import Failed**
   ```
   ❌ Error importing workflow: Login failed
   ```
   - Verify user credentials
   - Check N8N API availability
   - Validate workflow JSON format

### Debug Mode

Add debug logging by setting:
```bash
export DEBUG=1
```

### Logs

Check container logs:
```bash
docker logs <container-id>
```

## 🔒 Security Considerations

- **Passwords**: Use strong, randomly generated passwords
- **Secrets**: Store sensitive data in secure secret management
- **Network**: Restrict access to N8N instances appropriately
- **Container**: Runs as non-root user for security

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add your changes
4. Test with your N8N instance
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For issues and questions:

1. Check the troubleshooting section
2. Review container logs
3. Open a GitHub issue
4. Check N8N documentation

---

**Happy Automating!** 🚀
