'use strict'

class ServerlessCloudWatchLogsTagPlugin {
  cloudWatchLogsService () {
    if (!this._cloudFormationService) {
      this._cloudFormationService = new this.provider.sdk.CloudFormation({ region: this.region })
    }
    return this._cloudFormationService
  }

  constructor (serverless, options) {
    this._cloudWatchLogsService = null
    this._cloudFormationService = null

    this.serverless = serverless

    this.provider = this.serverless.getProvider('aws')
    this.options = options || {}
    this.region = this.provider.getRegion()
    this.stage = this.provider.getStage()
    this.tags = this.serverless.service.custom.cloudWatchLogsTags

    const commands = {
      deploy: {
        lifecycleEvents: ['packaging', 'functions', 'deploy']
      }
    }
    const hooks = {
      'after:deploy:deploy': this.execute.bind(this)
      // 'after:deploy:function:deploy': this.execute.bind(this)
    }
    this.commands = commands
    this.hooks = hooks
  }

  execute () {
    this.serverless.cli.log('ServerlessCloudWatchLogsTagPlugin-execute')
    this.serverless.cli.log(JSON.stringify(this.tags))
    const stackName = this.provider.naming.getStackName(this.stage)
    return this.processStack(stackName)
  }

  processStack (stackName) {
    this.serverless.cli.log(`ProcessStack-${stackName}`)
    return this.getStackResources(stackName)
      .then(data => this.tagCloudWatchLogs(data))
      .then(data => this.serverless.cli.log(JSON.stringify(data)))
      .catch(err => this.serverless.cli.log(JSON.stringify(err)))
  }

  getStackResources (stackName) {
    this.serverless.cli.log('getStackResources')
    this.serverless.cli.log(stackName)
    const getData = async (acc = [], nextToken) => {
      const data = await this.provider.request(
        'CloudFormation',
        'listStackResources',
        {
          StackName: stackName,
          NextToken: nextToken
        },
        this.stage,
        this.region
      )
      this.serverless.cli.log('getStackResources-data')
      if (data.NextToken) {
        return getData([...acc, ...data.StackResourceSummaries], data.NextToken)
      } else {
        return [...acc, ...data.StackResourceSummaries]
      }
    }
    return getData()
  }

  processLogGroup (item) {
    return new Promise((resolve, reject) => {
      this.serverless.cli.log(`Tag LogGroup Begin ${item.LogicalResourceId}`)
      this.provider.request(
        'CloudWatchLogs',
        'tagLogGroup',
        {
          logGroupName: item.PhysicalResourceId,
          tags: this.tags
        },
        this.stage,
        this.region
      ).then(() => {
        this.serverless.cli.log(`Tagged LogGroup ${item.LogicalResourceId}`)
        resolve(`Tagged LogGroup ${item.LogicalResourceId}`)
      }).catch((err) => {
        this.serverless.cli.log(`Tagged LogGroup ${item.LogicalResourceId} - Error`)
        this.serverless.cli.log(err)
        reject(err)
      })
    })
  }

  tagCloudWatchLogs (data) {
    this.serverless.cli.log('tagCloudWatchLogs')
    // Handle nested stacks recursively
    const nestedStackResources = data.filter(d => d.ResourceType === 'AWS::CloudFormation::Stack')
    this.serverless.cli.log(JSON.stringify(nestedStackResources))
    const nestedStackPromises = nestedStackResources.map(item => this.processStack(item.PhysicalResourceId))

    // Handle all log groups
    const cloudWatchResources = data.filter(d => d.ResourceType === 'AWS::Logs::LogGroup')
    this.serverless.cli.log(JSON.stringify(cloudWatchResources))
    const promises = cloudWatchResources.map(item => this.processLogGroup(item))

    const allPromises = nestedStackPromises.concat(promises)

    this.serverless.cli.log(`Updating logs in ${promises.length} logGroups and ${nestedStackPromises.length} nested stacks`)
    return Promise.all(allPromises)
  }
}

module.exports = ServerlessCloudWatchLogsTagPlugin
