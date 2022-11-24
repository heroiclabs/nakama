package sd

import (
	"context"
	"crypto/tls"
	"time"

	"go.etcd.io/etcd/client/pkg/v3/transport"
	clientv3 "go.etcd.io/etcd/client/v3"
	"google.golang.org/grpc"
)

type EtcdV3Client struct {
	cli *clientv3.Client
	ctx context.Context

	kv clientv3.KV

	// Watcher interface instance, used to leverage Watcher.Close()
	watcher clientv3.Watcher
	// watcher context
	wctx context.Context
	// watcher cancel func
	wcf context.CancelFunc

	// leaseID will be 0 (clientv3.NoLease) if a lease was not created
	leaseID clientv3.LeaseID

	hbch <-chan *clientv3.LeaseKeepAliveResponse
	// Lease interface instance, used to leverage Lease.Close()
	leaser clientv3.Lease
}

// ClientOptions defines options for the etcd client. All values are optional.
// If any duration is not specified, a default of 3 seconds will be used.
type EtcdClientOptions struct {
	Cert          string
	Key           string
	CACert        string
	DialTimeout   time.Duration
	DialKeepAlive time.Duration

	// DialOptions is a list of dial options for the gRPC client (e.g., for interceptors).
	// For example, pass grpc.WithBlock() to block until the underlying connection is up.
	// Without this, Dial returns immediately and connecting the server happens in background.
	DialOptions []grpc.DialOption

	Username string
	Password string
}

// NewEtcdV3Client returns Client with a connection to the named machines. It will
// return an error if a connection to the cluster cannot be made.
func NewEtcdV3Client(ctx context.Context, machines []string, options EtcdClientOptions) (Client, error) {
	if options.DialTimeout == 0 {
		options.DialTimeout = 3 * time.Second
	}
	if options.DialKeepAlive == 0 {
		options.DialKeepAlive = 3 * time.Second
	}

	var err error
	var tlscfg *tls.Config

	if options.Cert != "" && options.Key != "" {
		tlsInfo := transport.TLSInfo{
			CertFile:      options.Cert,
			KeyFile:       options.Key,
			TrustedCAFile: options.CACert,
		}
		tlscfg, err = tlsInfo.ClientConfig()
		if err != nil {
			return nil, err
		}
	}

	cli, err := clientv3.New(clientv3.Config{
		Context:           ctx,
		Endpoints:         machines,
		DialTimeout:       options.DialTimeout,
		DialKeepAliveTime: options.DialKeepAlive,
		DialOptions:       options.DialOptions,
		TLS:               tlscfg,
		Username:          options.Username,
		Password:          options.Password,
	})
	if err != nil {
		return nil, err
	}

	return &EtcdV3Client{
		cli: cli,
		ctx: ctx,
		kv:  clientv3.NewKV(cli),
	}, nil
}

func (c *EtcdV3Client) LeaseID() int64 { return int64(c.leaseID) }

// GetEntries implements the etcd Client interface.
func (c *EtcdV3Client) GetEntries(key string) ([]string, error) {
	resp, err := c.kv.Get(c.ctx, key, clientv3.WithPrefix())
	if err != nil {
		return nil, err
	}

	entries := make([]string, len(resp.Kvs))
	for i, kv := range resp.Kvs {
		entries[i] = string(kv.Value)
	}

	return entries, nil
}

// WatchPrefix implements the etcd Client interface.
func (c *EtcdV3Client) WatchPrefix(prefix string, ch chan struct{}) {
	c.wctx, c.wcf = context.WithCancel(c.ctx)
	c.watcher = clientv3.NewWatcher(c.cli)

	wch := c.watcher.Watch(c.wctx, prefix, clientv3.WithPrefix(), clientv3.WithRev(0))
	ch <- struct{}{}
	for wr := range wch {
		if wr.Canceled {
			return
		}
		ch <- struct{}{}
	}
}

func (c *EtcdV3Client) Register(s Service) error {
	var err error

	if s.Key == "" {
		return ErrNoKey
	}
	if s.Value == "" {
		return ErrNoValue
	}

	if c.leaser != nil {
		c.leaser.Close()
	}
	c.leaser = clientv3.NewLease(c.cli)

	if c.watcher != nil {
		c.watcher.Close()
	}
	c.watcher = clientv3.NewWatcher(c.cli)
	if c.kv == nil {
		c.kv = clientv3.NewKV(c.cli)
	}

	if s.TTL == nil {
		s.TTL = NewTTLOption(time.Second*3, time.Second*10)
	}

	grantResp, err := c.leaser.Grant(c.ctx, int64(s.TTL.ttl.Seconds()))
	if err != nil {
		return err
	}
	c.leaseID = grantResp.ID
	_, err = c.kv.Put(
		c.ctx,
		s.Key,
		s.Value,
		clientv3.WithLease(c.leaseID),
	)
	if err != nil {
		return err
	}

	// this will keep the key alive 'forever' or until we revoke it or
	// the context is canceled
	c.hbch, err = c.leaser.KeepAlive(c.ctx, c.leaseID)
	if err != nil {
		return err
	}

	// discard the keepalive response, make etcd library not to complain
	// fix bug #799
	go func() {
		for {
			select {
			case r := <-c.hbch:
				// avoid dead loop when channel was closed
				if r == nil {
					return
				}
			case <-c.ctx.Done():
				return
			}
		}
	}()

	return nil
}

func (c *EtcdV3Client) Deregister(s Service) error {
	defer c.close()

	if s.Key == "" {
		return ErrNoKey
	}
	if _, err := c.cli.Delete(c.ctx, s.Key, clientv3.WithIgnoreLease()); err != nil {
		return err
	}

	return nil
}

func (c *EtcdV3Client) Update(s Service) error {
	if s.Key == "" {
		return ErrNoKey
	}

	if _, err := c.cli.Put(c.ctx, s.Key, s.Value, clientv3.WithLease(c.leaseID)); err != nil {
		return err
	}

	return nil
}

// close will close any open clients and call
// the watcher cancel func
func (c *EtcdV3Client) close() {
	if c.leaser != nil {
		c.leaser.Close()
	}
	if c.watcher != nil {
		c.watcher.Close()
	}
	if c.wcf != nil {
		c.wcf()
	}
}
