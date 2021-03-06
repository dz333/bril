TESTS := test/parse/*.bril \
	test/print/*.json \
	test/interp/*.bril \
	test/mem/*.bril \
	test/fail/*.t \
	test/ts/*.ts \
	test/opt/*.bril

.PHONY: test
test:
	turnt $(TESTS)

.PHONY: save
save:
	turnt --save $(TESTS)

.PHONY: book
book:
	rm -rf book
	mdbook build

.PHONY: deploy
RSYNCARGS := --compress --recursive --checksum --itemize-changes \
	--delete -e ssh --perms --chmod=Du=rwx,Dgo=rx,Fu=rw,Fog=r
DEST := courses:coursewww/capra.cs.cornell.edu/htdocs/bril
deploy: book
	rsync $(RSYNCARGS) ./book/ $(DEST)
.PHONY: build
build:
	cd bril-ts; yarn build
