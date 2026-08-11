variable "commit_sha" {
  type        = string
  description = "The git commit SHA to use for the runtime image tag"
}

job "geo-db-update-live" {
  datacenters = ["ator-fin"]
  type = "batch"
  namespace = "live-services"
  
  constraint {
    attribute = "${meta.pool}"
    value = "live-services"
  }
  
  periodic {
    crons            = [ "@weekly" ]
    prohibit_overlap = true
  }
  
  group "geo-db-update-live-group" {
  	count = 1

    volume "api-service-live" {
      type      = "host"
      read_only = false
      source    = "api-service-live"
    }

    task "geo-db-update-live-task" {
      driver = "docker"

      config {
        image = "ghcr.io/anyone-protocol/api-service:${var.commit_sha}"
        command = "npm"
        args = [
          "run",
          "update-geo-ip-db"
        ]
      }

      vault {
        role = "any1-nomad-workloads-controller"
      }

      identity {
        name = "vault_default"
        aud  = ["any1-infra"]
        ttl  = "1h"
      }

      volume_mount {
        volume      = "api-service-live"
        destination = "/api-service-live"
        read_only   = false
      }

      env {
        GEODATADIR="/api-service-live/geo-ip-db/data"
        GEOTMPDIR="/api-service-live/tmp"
      }

      template {
        data = <<-EOH
        {{ with secret "kv/live-services/geo-db-update-live" }}
        LICENSE_KEY="{{ .Data.data.LICENSE_KEY }}"
        {{ end }}
        EOH
        destination = "secrets/keys.env"
        env         = true
      }
    }
  }
}
