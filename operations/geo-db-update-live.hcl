job "geo-db-update-test-live" {
  datacenters = ["ator-fin"]
  type = "batch"
  namespace = "ator-network"
  
  periodic {
    crons            = [ "0 3 * * 3,6" ] # every Wed and Sat at 3am
    prohibit_overlap = true
  }
  
  group "geo-db-update-test-live" {
  	
    volume "api-service-live" {
      type      = "host"
      read_only = false
      source    = "api-service-live"
    }
  
    task "run-weekly-npm-script" {
      driver = "docker"
      
      volume_mount {
        volume      = "api-service-live"
        destination = "/data"
        read_only   = false
      }

      config {
        image = "node:14-alpine"
        args = [
          "/bin/sh",
          "-c",
          "cd /data/node_modules/geoip-lite && npm run-script updatedb license_key=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",
        ]
      }
    }
  }
}