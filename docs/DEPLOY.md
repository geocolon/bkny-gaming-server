# Deploying to Kubernetes

1. Create the namespace first, because the Agones chart installs its SDK service account into it.

```bash
kubectl create namespace bkny
```

2. Install Agones, and tell it which namespace runs game servers. Check the [Agones docs](https://agones.dev/site/docs/installation/) for the Kubernetes versions your release supports.

```bash
helm repo add agones https://agones.dev/chart/stable
```

```bash
helm upgrade --install agones agones/agones --version 1.62.0 --namespace agones-system --create-namespace --set 'gameservers.namespaces={bkny}'
```

3. Build and push the images, then point `deploy/k8s/kustomization.yaml` at your registry.

```bash
docker build --target server -t YOUR_REGISTRY/bkny/server:v1 .
```

```bash
docker build --target edge -t YOUR_REGISTRY/bkny/edge:v1 .
```

```bash
docker build --target client -t YOUR_REGISTRY/bkny/client:v1 .
```

4. Create the secret that signs join tickets.

```bash
kubectl -n bkny create secret generic edge --from-literal=secret="$(openssl rand -hex 32)"
```

5. Apply the manifests.

```bash
kubectl apply -k deploy/k8s
```

6. Install an NGINX ingress controller and add a host and TLS to `deploy/k8s/ingress.yaml`. Browsers need HTTPS in production.

## Checks

```bash
kubectl -n bkny get fleet,gameservers,fleetautoscaler
```

You should see two `Ready` game servers. Each new room moves one to `Allocated`, and the autoscaler starts a replacement.

## AWS EKS notes

- Your CNI must enforce NetworkPolicy, or game pods stay reachable from inside the cluster. On EKS, enable network policy support in the VPC CNI.
- Put game servers on their own node group with a taint and matching tolerations, so noisy workloads can't take their CPU.
- Use `cluster-autoscaler` or Karpenter, but stop them from consolidating nodes that hold Allocated game servers.
- A load balancer needs an idle timeout longer than a quiet match, or sockets get cut. The client's one-second ping helps keep them alive.
- Game traffic stays inside the cluster, so you don't need to open the Agones 7000-8000 port range to the internet.
