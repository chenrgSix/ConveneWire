package peer

import (
	"context"
	"sync"
)

// Shared installation lifetime for independent Owner capabilities. In
// particular, departure must remain usable if the human vault cannot open.
type ownerLifetime struct {
	mu            sync.Mutex
	ctx           context.Context
	cancel        context.CancelFunc
	closed        bool
	active        sync.WaitGroup
	checkIdentity func() error
}

func newOwnerLifetime(checkIdentity func() error) *ownerLifetime {
	ctx, cancel := context.WithCancel(context.Background())
	return &ownerLifetime{ctx: ctx, cancel: cancel, checkIdentity: checkIdentity}
}

func (o *ownerLifetime) Close() {
	o.mu.Lock()
	o.closed = true
	o.cancel()
	o.mu.Unlock()
	o.active.Wait()
}

func (o *ownerLifetime) check() error {
	o.mu.Lock()
	closed := o.closed
	o.mu.Unlock()
	if closed {
		return context.Canceled
	}
	return o.checkIdentity()
}

func (o *ownerLifetime) begin(ctx context.Context) (context.Context, func(), error) {
	o.mu.Lock()
	if o.closed {
		o.mu.Unlock()
		return nil, nil, context.Canceled
	}
	o.active.Add(1)
	o.mu.Unlock()
	scoped, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(o.ctx, cancel)
	done := func() { stop(); cancel(); o.active.Done() }
	if err := o.check(); err != nil {
		done()
		return nil, nil, err
	}
	if err := scoped.Err(); err != nil {
		done()
		return nil, nil, err
	}
	return scoped, done, nil
}
